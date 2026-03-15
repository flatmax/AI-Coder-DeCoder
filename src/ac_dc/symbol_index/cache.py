"""Symbol cache — in-memory, mtime-based, extends BaseCache."""

import hashlib

from ac_dc.base_cache import BaseCache
from ac_dc.symbol_index.models import FileSymbols


class SymbolCache(BaseCache):
    """Mtime-based cache for FileSymbols.

    Content hash is computed from symbol signatures (names, types, parameters)
    rather than formatted output, to avoid spurious mismatches when path
    aliases or exclusion sets change.
    """

    def _compute_hash(self, data) -> str:
        """Compute a signature hash from FileSymbols."""
        if not isinstance(data, FileSymbols):
            return super()._compute_hash(data)
        return self._signature_hash(data)

    @staticmethod
    def _signature_hash(fs: FileSymbols) -> str:
        """Deterministic hash from symbol signatures."""
        parts = []
        for sym in fs.all_symbols_flat:
            sig = f"{sym.kind}:{sym.name}"
            if sym.parameters:
                param_strs = []
                for p in sym.parameters:
                    ps = p.name
                    if p.type_hint:
                        ps += f":{p.type_hint}"
                    if p.default is not None:
                        ps += "?"
                    if p.is_variadic:
                        ps = "*" + ps
                    if p.is_keyword:
                        ps = "**" + ps
                    param_strs.append(ps)
                sig += f"({','.join(param_strs)})"
            if sym.return_type:
                sig += f"->{sym.return_type}"
            if sym.bases:
                sig += f"<{','.join(sym.bases)}"
            if sym.is_async:
                sig += ":async"
            parts.append(sig)

        for imp in fs.imports:
            parts.append(f"import:{imp.module}:{','.join(imp.names)}:{imp.level}")

        raw = "|".join(sorted(parts))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]