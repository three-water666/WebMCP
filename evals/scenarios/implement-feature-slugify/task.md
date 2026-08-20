# Task: implement `slugify`

Complete `slugify(input, options)` in `src/slugify.mjs`.

Requirements:

- Throw `TypeError("input must be a string")` for non-string input.
- Trim, lowercase, normalize accented Latin characters, and convert `&` to `and`.
- Replace every run of non-alphanumeric characters with one `-` and trim edge dashes.
- Support `options.maxLength`, defaulting to 64. It must be a positive integer.
- Truncation must never leave a trailing dash.
- Do not add runtime dependencies or change the exported API.
