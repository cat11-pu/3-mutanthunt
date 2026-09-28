// tests/spec.js：待你补完的测试文件（现在是桩，什么都不查）。
// 约定：用环境变量 IGNORE_MODULE 拿被测模块的绝对路径（没给时用 ../index.js），
// 断言不过就让进程非零退出，这样 runner.js 才算把一个变异体杀掉。
const assert = require("node:assert");
const path = require("path");

const modulePath = process.env.IGNORE_MODULE || path.resolve(__dirname, "..", "index.js");
const make = require(modulePath);

console.log("桩测试：还没有断言，" + path.basename(modulePath) + " 不会被杀掉");
process.exit(0);
