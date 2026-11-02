import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { WebDavSource } from '../../src/domain/source-types'
import { encodeRemotePath, relativePath, remoteUrl, SourceTransfer } from './common'
import { SourceError } from './types'

type XmlObject = Record<string,unknown>
const object = (value:unknown):XmlObject => value && typeof value === 'object' && !Array.isArray(value) ? value as XmlObject : {}
const list = (value:unknown):unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value]
const success = (value:unknown) => typeof value === 'string' && /^HTTP\/\d(?:\.\d)?\s+2\d\d\b/.test(value.trim())
const propfind = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>'

/** Decode once, preserving Unicode/spaces while forbidding encoded separators. */
function decodedPath(pathname:string) {
  if (/%(?:2f|5c)/i.test(pathname)) throw new SourceError('WebDAV 路径包含编码后的目录分隔符。', 'unsafe_path')
  try {
    const parts = pathname.split('/').map(decodeURIComponent)
    if (parts.some(part => part === '..' || part === '.' || /[\\\u0000-\u001f\u007f]/.test(part))) throw new Error()
    return parts.join('/')
  } catch { throw new SourceError('WebDAV 返回了不安全或无效编码的路径。', 'unsafe_path') }
}

export async function downloadWebDav(source:WebDavSource,transfer:SourceTransfer) {
  const entry = relativePath(source.entryPath)
  const root = remoteUrl(source.url)
  root.pathname = root.pathname.replace(/\/*$/,'/')
  const rootDecoded = decodedPath(root.pathname)
  const headers:Record<string,string> = { 'User-Agent':'Countwell' }
  if (source.token && (source.username || source.password)) throw new SourceError('WebDAV 请在 Bearer token 与用户名密码之间选择一种认证方式。', 'invalid_config')
  if (source.token) headers.Authorization = `Bearer ${source.token}`
  else if (source.username || source.password) headers.Authorization = `Basic ${Buffer.from(`${source.username ?? ''}:${source.password ?? ''}`,'utf8').toString('base64')}`
  const parser = new XMLParser({removeNSPrefix:true,ignoreAttributes:true,parseTagValue:false,trimValues:true,processEntities:true})
  const queue:{url:URL;path:string;depth:number}[] = [{url:root,path:'',depth:0}]
  const visited = new Set<string>()
  let directories = 0
  while (queue.length) {
    const current = queue.shift()!
    if (visited.has(current.path)) continue
    visited.add(current.path)
    if (++directories > transfer.limits.maxDirectories || current.depth > transfer.limits.maxDepth) throw new SourceError('WebDAV 目录数量或层级超过限额。', 'limit_exceeded')
    const xml = Buffer.from(await transfer.request(current.url,{method:'PROPFIND',headers:{...headers,Depth:'1','Content-Type':'application/xml; charset=utf-8'},body:propfind})).toString('utf8')
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new SourceError('WebDAV 返回了无效或不支持的 XML。', 'invalid_response')
    let parsed:XmlObject
    try { parsed = object(parser.parse(xml)) } catch { throw new SourceError('WebDAV XML 无法解析。', 'invalid_response') }
    const responses = list(object(parsed.multistatus).response)
    if (!responses.length) throw new SourceError('WebDAV 没有返回目录内容。', 'invalid_response')
    for (const raw of responses) {
      const response = object(raw)
      if (typeof response.href !== 'string') throw new SourceError('WebDAV 目录项缺少路径。', 'invalid_response')
      // Inspect raw href too: URL would otherwise normalise encoded dot segments.
      decodedPath(response.href.split(/[?#]/)[0])
      let url:URL
      try { url = new URL(response.href,current.url) } catch { throw new SourceError('WebDAV 目录项地址无效。', 'unsafe_path') }
      if (url.origin !== root.origin || url.username || url.password || url.search || url.hash) throw new SourceError('WebDAV 文件地址越过已配置的数据源。', 'unsafe_path')
      const decoded = decodedPath(url.pathname)
      if (decoded === rootDecoded.slice(0,-1)) continue
      if (!decoded.startsWith(rootDecoded)) throw new SourceError('WebDAV 文件地址越过源根目录。', 'unsafe_path')
      const path = decoded.slice(rootDecoded.length).replace(/\/$/,'')
      if (path === current.path.replace(/\/$/,'')) continue
      relativePath(path)
      const parent = path.includes('/') ? path.slice(0,path.lastIndexOf('/')+1) : ''
      if (parent !== current.path) throw new SourceError('WebDAV 没有遵循单层目录枚举，已停止读取。', 'invalid_response')
      if (response.status && !success(response.status)) throw new SourceError('WebDAV 有无法读取的目录项。', 'remote_error')
      const properties = list(response.propstat).map(object).filter(stat => success(stat.status)).map(stat => object(stat.prop))
      const resource = properties.find(prop => Object.hasOwn(prop,'resourcetype'))
      if (!resource) throw new SourceError('WebDAV 无法读取文件类型属性。', 'remote_error')
      const isDirectory = Object.hasOwn(object(resource.resourcetype),'collection')
      if (isDirectory) {
        if (current.depth + 1 > transfer.limits.maxDepth) throw new SourceError('WebDAV 目录层级超过限额。', 'limit_exceeded')
        const canonical = new URL(encodeRemotePath(path)+'/',root)
        queue.push({url:canonical,path:path+'/',depth:current.depth+1})
      } else {
        const length = properties.find(prop => Object.hasOwn(prop,'getcontentlength'))?.getcontentlength
        if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > transfer.limits.maxFileBytes)) throw new SourceError('WebDAV 文件大小超过限额或无效。', 'limit_exceeded')
        const canonical = new URL(encodeRemotePath(path),root)
        const bytes = await transfer.request(canonical,{headers},transfer.limits.maxFileBytes)
        await transfer.store(path,bytes)
      }
    }
  }
  if (!transfer.files.includes(entry)) throw new SourceError('入口文件不在 WebDAV 源根目录中。', 'missing_entry')
  return {entry,description:'WebDAV 账本'}
}
