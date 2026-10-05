# Synthetic encrypted menu fixture

`encrypted-menu.pdf` is a password-protected copy of `columns-and-sizes-text.pdf`, used by the D156 browser preparation regression. It contains only the synthetic menu. It is not evidence of model/production PDF support.

Generated locally with pypdf 6.10.0 (fixture utility only; no app dependency). Regenerate deliberately from the repository root:

```python
from pypdf import PdfReader, PdfWriter
writer = PdfWriter()
writer.append(PdfReader("server/features/assistant/eval/fixtures/columns-and-sizes-text.pdf"))
writer.encrypt("synthetic-menu-only", algorithm="RC4-128")
writer.write("server/features/assistant/eval/fixtures/encrypted-menu.pdf")
```

The password/encryption method are test inputs, not a recommendation for protecting real data. Original menu fixtures still come from `../generate-fixtures.ts`; no real cafe/customer documents are checked in.
