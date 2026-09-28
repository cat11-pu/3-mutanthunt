#!/usr/bin/env node
// 验收台：把 tests/spec.js 依次跑在原版与每个变异体上，统计杀灭数。
// 环境变量 IGNORE_MODULE 给被测模块的绝对路径（不给时的默认值在测试里定）。
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = __dirname;
const SPEC = path.join(ROOT, "tests", "spec.js");
const UNDER = path.join(ROOT, ".under-test.js");
const MUTANTS = fs.readdirSync(path.join(ROOT, "mutants")).filter(function (f) {
  return f.endsWith(".js");
}).sort();

if (!fs.existsSync(SPEC)) {
  console.log("缺少 tests/spec.js");
  process.exit(2);
}

function runWith(modulePath) {
  const res = spawnSync(process.execPath, [SPEC], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { IGNORE_MODULE: modulePath }),
    encoding: "utf8"
  });
  const text = (res.stdout || "") + (res.stderr || "");
  return { code: res.status === null ? 1 : res.status, text: text };
}

const original = runWith(path.join(ROOT, "index.js"));
const originalOk = original.code === 0;
console.log("原版：" + (originalOk ? "通过" : "未通过"));
if (!originalOk) {
  console.log(original.text.split("\n").slice(0, 12).join("\n"));
}

let killed = 0;
for (const file of MUTANTS) {
  fs.copyFileSync(path.join(ROOT, "mutants", file), UNDER);
  const res = runWith(UNDER);
  const isKilled = res.code !== 0;
  if (isKilled) killed += 1;
  console.log(file + "：" + (isKilled ? "已杀灭" : "漏网（测试没挂）"));
}
try { fs.unlinkSync(UNDER); } catch (error) { /* 没生成过就算了 */ }
console.log("杀灭 " + killed + "/" + MUTANTS.length + (originalOk ? "，原版通过" : "，原版未通过"));
const pass = originalOk && killed === MUTANTS.length;
console.log(pass ? "验收通过" : "验收未通过");
process.exit(pass ? 0 : 1);
