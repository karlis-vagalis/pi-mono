# Block Root Find

Prevent accidental filesystem-wide searches in Pi. The extension blocks Bash tool calls containing `find /` and Pi `find` tool calls whose `path` is `/` or `//`. The block message asks the agent to narrow the search; commands such as `find ./src -name '*.ts'` still work.

This is a guard against accidental scans, not a shell sandbox.

## Install

```bash
pi install npm:@karlis-vagalis/pi-block-root-find
```

Run `/reload` in an existing Pi session.
