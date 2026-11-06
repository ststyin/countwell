"""JSON bridge to the complete, uncached official Beancount v3 loader.

Input is one JSON object on stdin. Only this module's final JSON goes to stdout;
loader and explicitly trusted plugin output is discarded, never logged.
"""
from __future__ import annotations

import contextlib
from datetime import date, datetime, timezone
from decimal import Context, Decimal, DivisionByZero, InvalidOperation, Overflow, ROUND_HALF_EVEN, localcontext
import json
import os
from pathlib import Path
import re
import sys


class BridgeError(Exception):
    def __init__(self, code, message, diagnostics=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.diagnostics = diagnostics or []


def error_response(error):
    return {"ok": False, "error": {"code": error.code, "message": error.message,
                                    "diagnostics": error.diagnostics}}


def main(request):
    try:
        import beancount
        from beancount import loader
        from beancount.core import convert, data
        from beancount.parser import parser
    except ImportError:
        raise BridgeError("ENGINE_UNAVAILABLE", "未找到官方 Beancount 引擎，请安装 requirements.txt 中的依赖。")

    entry = Path(request["entryPath"]).expanduser().resolve(strict=True)
    if not entry.is_file():
        raise BridgeError("ENTRY_NOT_FOUND", "账本入口必须是可读取的文件。")
    source_root = Path(request["sourceRoot"]).resolve(strict=True) if request.get("sourceRoot") else None
    allow_plugins = request.get("allowPlugins") is True
    sources = {}
    original_parse_file = parser.parse_file

    def relative_name(filename):
        try:
            path = Path(filename).resolve()
            base = source_root or Path(os.path.commonpath([str(p.parent) for p in sources] or [str(entry.parent)]))
            return path.relative_to(base).as_posix()
        except (ValueError, OSError, TypeError):
            return None

    def checked_path(filename):
        path = Path(filename).resolve()
        if source_root is not None and not path.is_relative_to(source_root):
            raise BridgeError("OUTSIDE_SOURCE_ROOT", "include 路径超出数据源目录，请调整入口目录或 include 路径。")
        return path

    def guarded_parse(filename, *args, **kwargs):
        # This guard surrounds the official file parser; include expansion,
        # booking and validation remain the official loader's responsibility.
        path = checked_path(filename).resolve(strict=True)
        # Encrypted input can launch an external decryption program before
        # parse_file. The entry check below handles that official loader path.
        text = path.read_text(encoding="utf-8-sig")
        sources[path] = text
        parsed = original_parse_file(filename, *args, **kwargs)
        options = parsed[2]
        if options.get("plugin") and not allow_plugins:
            line = next((i for i, value in enumerate(text.splitlines(), 1) if re.match(r"^\s*plugin\s", value)), None)
            diagnostic = {"file": relative_name(path), "line": line,
                          "message": "账本声明了 Python 插件；确认信任后才会执行。"}
            raise BridgeError("PLUGIN_TRUST_REQUIRED", "此账本包含插件，请先确认信任该账本及其插件。", [diagnostic])
        return parsed

    # Reject encrypted files before the loader can invoke a decryption process.
    # Wrapping this predicate also covers encrypted files reached via include.
    original_encrypted = loader.encryption.is_encrypted_file

    def guarded_encrypted(filename):
        checked_path(filename)
        if original_encrypted(filename):
            raise BridgeError("ENCRYPTED_LEDGER_UNSUPPORTED", "请先在本机解密账本，再配置解密后的入口文件。")
        return False

    parser.parse_file = guarded_parse
    loader.encryption.is_encrypted_file = guarded_encrypted
    # No pickle cache is read, created or removed. This private v3 entry is
    # covered by the real-engine integration tests and the pinned dependency.
    entries, errors, options = loader._uncached_load_file(str(entry), None, None, None)
    if errors:
        def diagnostic(error):
            source = getattr(error, "source", {}) or {}
            kind = type(error).__name__
            message = str(getattr(error, "message", ""))
            if kind == "BalanceError":
                label = "余额断言不一致，请核对该日期之前的交易。"
            elif "Booking" in kind or "Ambiguous" in kind:
                label = "成本批次匹配失败，请核对买入成本和卖出批次。"
            elif "Load" in kind:
                label = "include 文件缺失、重复包含或插件处理失败。"
            elif "unknown account" in message.lower():
                label = "交易引用了尚未开立的账户。"
            elif "unbalanced" in message.lower() or "balance" in message.lower():
                label = "交易未按官方规则平衡，请核对金额、成本与价格。"
            elif "Parser" in kind or "Lexer" in kind:
                label = "Beancount 语法解析失败，请核对该行。"
            else:
                label = "官方 Beancount 校验失败，请核对该处指令。"
            return {"file": relative_name(source.get("filename")), "line": source.get("lineno"), "message": label}
        raise BridgeError("LEDGER_INVALID", f"官方 Beancount 校验发现 {len(errors)} 项错误，未加载任何部分结果。",
                          [diagnostic(error) for error in errors[:100]])

    amounts = []
    for item in entries:
        if isinstance(item, data.Transaction):
            for posting in item.postings:
                amounts.append(posting.units.number)
                amounts.extend(annotation.number for annotation in (posting.cost, posting.price) if annotation is not None)
        elif isinstance(item, data.Price):
            amounts.append(item.amount.number)
    if any(not isinstance(amount, Decimal) or not amount.is_finite() for amount in amounts):
        raise BridgeError("LEDGER_INVALID", "账本含有未解析或非有限金额，已拒绝展示。")
    integer_digits = max((max(amount.adjusted() + 1, 1) for amount in amounts), default=1)
    scale = max((max(-amount.as_tuple().exponent, 0) for amount in amounts), default=0)
    precision = max(80, 2 * (integer_digits + scale) + len(str(len(amounts) + 1)) + 16)
    context = Context(prec=precision, rounding=ROUND_HALF_EVEN, Emin=-999999, Emax=999999,
                      capitals=1, clamp=0, flags=[], traps=[InvalidOperation, DivisionByZero, Overflow])

    roots = {name: options[f"name_{name}"] for name in ("assets", "liabilities", "income", "expenses", "equity")}
    kinds = {roots["assets"]: "asset", roots["liabilities"]: "liability", roots["income"]: "income",
             roots["expenses"]: "expense", roots["equity"]: "equity"}
    investment_accounts = {p.account for item in entries if isinstance(item, data.Transaction)
                           for p in item.postings if p.cost is not None}
    noncash_components = {"investment", "investments", "fund", "funds", "stock", "stocks", "bond", "bonds",
                          "receivable", "receivables", "loan", "loans", "other", "otherassets"}
    cash_components = {"cash", "bank", "banks", "debit", "deposit", "deposits"}
    accounts = []
    for item in entries:
        if not isinstance(item, data.Open):
            continue
        kind = kinds.get(item.account.split(":", 1)[0], "asset")
        role = item.meta.get("countwell_role")
        if role not in ("cash", "investment", "other"):
            parts = {part.lower() for part in item.account.split(":")[1:]}
            role = ("investment" if item.account in investment_accounts else
                    "other" if kind == "asset" and parts & noncash_components and not parts & cash_components else
                    "cash" if kind == "asset" else "other")
        label = item.meta.get("display_name") or item.meta.get("name") or item.account.split(":")[-1]
        accounts.append({"name": item.account, "label": label if isinstance(label, str) else item.account,
                         "kind": kind, "role": role})

    transactions = []
    with localcontext(context):
        for index, item in enumerate(entries):
            if not isinstance(item, data.Transaction):
                continue
            postings = []
            for posting in item.postings:
                weight = convert.get_weight(posting)
                value = {"account": posting.account, "amount": format(posting.units.number, "f"),
                         "currency": posting.units.currency, "flag": posting.flag,
                         "weight": {"amount": format(weight.number, "f"), "currency": weight.currency}}
                if posting.cost is not None:
                    value["cost"] = {"amount": format(posting.cost.number, "f"), "currency": posting.cost.currency,
                                     "date": posting.cost.date.isoformat() if posting.cost.date else None,
                                     "label": posting.cost.label}
                if posting.price is not None:
                    value["price"] = {"amount": format(posting.price.number, "f"), "currency": posting.price.currency}
                postings.append(value)
            transactions.append({"id": f"tx-{index}", "date": item.date.isoformat(), "payee": item.payee or "",
                                 "narration": item.narration or "", "flag": item.flag, "tags": sorted(item.tags),
                                 "links": sorted(item.links), "postings": postings})

    # A common directory preserves nested/sibling include paths in the file view
    # without serializing absolute host filesystem locations.
    base = source_root or Path(os.path.commonpath([str(path.parent) for path in sources] or [str(entry.parent)]))
    files = [{"path": path.relative_to(base).as_posix(), "content": content} for path, content in sorted(sources.items())]
    return {"ok": True, "ledger": {
        "title": options.get("title") or "我的账本", "source": sources.get(entry, ""),
        "defaultMonth": max((item["date"][:7] for item in transactions), default=date.today().strftime("%Y-%m")),
        "accounts": sorted(accounts, key=lambda account: account["name"]),
        "accountNames": sorted(account["name"] for account in accounts), "transactions": transactions,
        "prices": [{"date": item.date.isoformat(), "commodity": item.currency,
                    "amount": format(item.amount.number, "f"), "currency": item.amount.currency}
                   for item in entries if isinstance(item, data.Price)],
        "commodities": sorted({item.currency for item in entries if isinstance(item, data.Commodity)}),
        "roots": roots, "operatingCurrencies": options.get("operating_currency", []), "files": files,
        "loadedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "engine": {"name": "beancount", "version": beancount.__version__},
    }}


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        with open(os.devnull, "w", encoding="utf-8") as quiet:
            with contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
                response = main(request)
    except BridgeError as error:
        response = error_response(error)
    except FileNotFoundError:
        response = error_response(BridgeError("ENTRY_NOT_FOUND", "账本入口或 include 文件不存在，请检查配置路径。"))
    except (Exception, SystemExit, KeyboardInterrupt):
        response = error_response(BridgeError("ENGINE_LOAD_FAILED", "官方 Beancount 未能完整加载账本，请在本机核对入口、include 与已授权插件。"))
    sys.stdout.write(json.dumps(response, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
