---
"@open-trainer/ftms": patch
---

Use the published `@deancochran/ftms` control-request encoder behind the existing
command helpers. Preserve Open Trainer's quantization, validation errors, public
API and explicit UINT8 resistance compatibility path. No transport, control
ownership, parser or hardware-qualification behavior changes.
