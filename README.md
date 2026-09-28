# mutanthunt

仓库里是一个真实的 gitignore 语义实现（`index.js`，来自 kaelzhang/node-ignore，MIT），
`mutants/` 下是 6 个只改了一处的副本。任务是把 `tests/spec.js` 写成一套测试：
对原版全过，并且每个变异体都要被挂掉一处。

## 跑验收

    node runner.js

它会先用原版跑一遍 `tests/spec.js`（必须过），再把每个变异体换上跑一遍，
统计杀灭数；只有「原版通过 + 6 个全杀」才算通过（退出码 0）。

## 约束

- 只改 `tests/spec.js`；`index.js`、`mutants/`、`runner.js` 都不要动。
- 测试通过环境变量 `IGNORE_MODULE` 拿被测模块的绝对路径，没给时用 `../index.js`。
- 只用 Node 自带能力（`node:assert` 等），不要引入依赖。
