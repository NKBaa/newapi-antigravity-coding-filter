# Changelog

## [1.0.0]

### Added

- Initial New API request processing plugin. It cloaks or rewrites other coding agents' names in the system/developer prompt sent to Antigravity channels, using the same 48-name preset, model-name and ambiguous-name options, custom mappings, whole-word matching, code protection and zero-width-space cloaking as the magpie middleware.
- Handles OpenAI Chat Completions, OpenAI Responses, Claude Messages and Gemini GenerateContent request bodies, and reports matched names as findings in the usage log.
