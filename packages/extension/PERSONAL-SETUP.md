# Personal Extension Setup

This folder is a standalone copy of the VS Code extension, prepared for your personal GitHub repository.

## Why this is independent from private pipeline

- Extension auto-configures MCP with public npm package: aidlc-pipeline
- It does not require private repository access at runtime
- Skills/agents are loaded through the public MCP package configured in settings

## Before publishing from your personal repo

1. Update extension identity in package.json:
- name
- displayName
- publisher
- repository.url
- icon (optional)

2. Optional: change default MCP package setting in package.json
- cfPipeline.mcpPackage default is aidlc-pipeline

3. Build and test:
- npm install
- npm run compile

4. Publish extension:
- vsce package
- vsce publish (or OpenVSX publish)

## Runtime notes

- Users only need your extension + npm access to aidlc-pipeline
- If needed, users can override package via setting: cfPipeline.mcpPackage
