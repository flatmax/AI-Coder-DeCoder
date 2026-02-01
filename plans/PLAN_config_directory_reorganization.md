# Plan: Config Directory Reorganization

**Status: COMPLETE**

## Goal

Consolidate all configuration files, prompts, and skill definitions into a coherent directory structure under a new `config/` directory at the repository root.

## Final Structure

```
config/
├── app.json                    # renamed from ac-dc.json
├── llm.json                    # LLM model settings
├── prompt-snippets.json        # User prompt snippets
└── prompts/
    ├── system.md               # renamed from sys_prompt_v3.md
    ├── system_extra.md         # renamed from sys_prompt_extra.md
    └── skills/
        └── compaction.md       # renamed from compaction_skill.md
```

## Git Commands to Move Files

```bash
# Create new directory structure
mkdir -p config/prompts/skills

# Move and rename config files
git mv ac-dc.json config/app.json
git mv llm.json config/llm.json
git mv prompt-snippets.json config/prompt-snippets.json

# Move and rename prompt files
git mv sys_prompt_v3.md config/prompts/system.md
git mv sys_prompt_extra.md config/prompts/system_extra.md
git mv ac/prompts/compaction_skill.md config/prompts/skills/compaction.md

# Remove backup file
git rm sys_prompt_v3.md.bak
```

## Code Files Updated

- `ac/prompts/loader.py` - Updated paths for system.md, system_extra.md
- `ac/context/topic_detector.py` - Updated path for compaction.md
- `ac/llm/config.py` - Updated default config path to config/llm.json
- `ac/llm/llm.py` - Updated prompt-snippets.json path
- `ac/url_handler/config.py` - Updated app.json path
- `README.md` - Updated documentation

## Testing

Run tests to verify:
```bash
pytest tests/ -v
```

Manual testing:
1. Start the application and verify it loads
2. Check that prompts load correctly
3. Verify LLM config is read
4. Test history compaction to ensure skill prompt loads
