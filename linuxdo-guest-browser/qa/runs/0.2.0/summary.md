# Release 0.2.0 兼容性测试摘要

门禁：**BLOCKED**

运行记录：7；矩阵结果：PASS 0 / FAIL 0 / BLOCKED 14。

| 目标 | 平台 | IDE 版本 | 构建 | 结果 | 说明 |
| --- | --- | --- | --- | --- | --- |
| vscode-1.85 | darwin | 1.85.2 | - | BLOCKED | 未通过用例：SHR-002, SHR-003, SHR-004, SHR-006, VSC-003, VSC-004, VSC-006, VSC-007, VSC-008, VSC-009, VSC-010, VSC-011 |
| vscode-1.85 | win32 | 1.85.2 | - | BLOCKED | IDE 下载包尚未在该平台实际下载并完成 SHA-256 校验。 |
| vscode-1.113 | darwin | 1.113.0 | - | BLOCKED | 未通过用例：SHR-002, SHR-003, SHR-004, SHR-006, VSC-003, VSC-004, VSC-006, VSC-007, VSC-008, VSC-009, VSC-010, VSC-011 |
| vscode-1.113 | win32 | 1.113.0 | - | BLOCKED | IDE 下载包尚未在该平台实际下载并完成 SHA-256 校验。 |
| vscode-1.114 | darwin | 1.114.0 | - | BLOCKED | 未通过用例：SHR-002, SHR-003, SHR-004, SHR-006, VSC-003, VSC-005, VSC-006, VSC-007, VSC-008, VSC-009, VSC-010, VSC-011 |
| vscode-1.114 | win32 | 1.114.0 | - | BLOCKED | IDE 下载包尚未在该平台实际下载并完成 SHA-256 校验。 |
| vscode-latest | darwin | 1.137.0 | - | BLOCKED | 未通过用例：SHR-002, SHR-003, SHR-004, SHR-005, SHR-006, VSC-003, VSC-005, VSC-006, VSC-007, VSC-008, VSC-009, VSC-010, VSC-011, VSC-012 |
| vscode-latest | win32 | 1.137.0 | - | BLOCKED | IDE 下载包尚未在该平台实际下载并完成 SHA-256 校验。 |
| pycharm-2022.3 | darwin | 2022.3.3 | 223.8836.43 | BLOCKED | 未通过用例：PYC-002, PYC-003, PYC-004, PYC-005, PYC-006, PYC-007, PYC-008, PYC-009, PYC-010, SHR-002, SHR-003, SHR-004, SHR-006 |
| pycharm-2022.3 | win32 | 2022.3.3 | 223.8836.43 | BLOCKED | IDE 下载包尚未在该平台实际下载并完成 SHA-256 校验。 |
| pycharm-2024.2 | darwin | 2024.2.6 | 242.26775.22 | BLOCKED | 未通过用例：PYC-002, PYC-003, PYC-004, PYC-005, PYC-006, PYC-007, PYC-008, PYC-009, PYC-010, SHR-002, SHR-003, SHR-004, SHR-006 |
| pycharm-2024.2 | win32 | 2024.2.6 | 242.26775.22 | BLOCKED | IDE 下载包尚未在该平台实际下载并完成 SHA-256 校验。 |
| pycharm-latest | darwin | 2026.2.2 | 262.10315.174 | BLOCKED | 未通过用例：PYC-002, PYC-003, PYC-004, PYC-005, PYC-006, PYC-007, PYC-008, PYC-009, PYC-010, PYC-011, SHR-002, SHR-003, SHR-004, SHR-005, SHR-006 |
| pycharm-latest | win32 | 2026.2.2 | 262.10315.174 | BLOCKED | IDE 下载包尚未在该平台实际下载并完成 SHA-256 校验。 |

## 已执行记录

| Run ID | 目标 | 平台 | IDE | PASS | FAIL | BLOCKED | 工作树 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 20260909T182215Z-vscode-1.85-darwin-arm64 | vscode-1.85 | darwin-arm64 | 1.85.2 | 4 | 0 | 0 | CLEAN |
| 20260909T182219Z-vscode-1.113-darwin-arm64 | vscode-1.113 | darwin-arm64 | 1.113.0 | 4 | 0 | 0 | CLEAN |
| 20260909T182223Z-vscode-1.114-darwin-arm64 | vscode-1.114 | darwin-arm64 | 1.114.0 | 4 | 0 | 0 | CLEAN |
| 20260909T182227Z-vscode-latest-darwin-arm64 | vscode-latest | darwin-arm64 | 1.137.0 | 4 | 0 | 0 | CLEAN |
| 20260909T182231Z-pycharm-2022.3-darwin-arm64 | pycharm-2022.3 | darwin-arm64 | 2022.3.3 | 3 | 0 | 0 | CLEAN |
| 20260909T182235Z-pycharm-2024.2-darwin-arm64 | pycharm-2024.2 | darwin-arm64 | 2024.2.6 | 3 | 0 | 0 | CLEAN |
| 20260909T182239Z-pycharm-latest-darwin-arm64 | pycharm-latest | darwin-arm64 | 2026.2.2 | 3 | 0 | 0 | CLEAN |

## 判定规则

- 每个锁定目标必须在 macOS 和 Windows 上完成所有适用的 P0/P1 用例。
- 人工引导用例只有附带脱敏证据的 PASS 才计入通过。
- 未解析版本、未校验 IDE 下载包、缺少 Windows 节点或环境不兼容均保持 BLOCKED。
- 尚未发布的 JetBrains 构建只能保留声明，不能列为已实测。
