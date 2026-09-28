// tests/spec.js
//
// 一套对 node-ignore 语义的“变异体猎手”测试：
// 对原版 index.js 必须全部通过，对 mutants/ 下的 6 个单点变异体
// 每个都必须至少有一条断言失败（进程非零退出）。
//
// 被测模块通过环境变量 IGNORE_MODULE 给绝对路径，未给时回落到 ../index.js。
// 六处偏差彼此独立，每处都给至少两条用例：一条正面定行为，一条压低边界。
// 只使用 Node 自带能力，不引入任何依赖。

const assert = require('node:assert')
const path = require('path')

const modulePath = process.env.IGNORE_MODULE
  || path.resolve(__dirname, '..', 'index.js')

const makeIgnore = require(modulePath)

const TAB = '\t'

// 小工具：断言“会忽略 / 不会忽略”，失败信息里带上规则与路径，方便定位。
function expectIgnore (ig, rule, input, expected, note) {
  assert.strictEqual(
    ig.ignores(input),
    expected,
    `规则 ${JSON.stringify(rule)} 对路径 ${JSON.stringify(input)} `
      + `应当${expected ? '被' : '不被'}忽略（${note || ''}）`
  )
}

// ---------------------------------------------------------------------------
// m1：尾随空白只能修剪空格，绝不能修剪制表符
//
// git（dir.c 的 trim_trailing_spaces，单个 case ' '）只会裁掉行尾的空格，
// 制表符是路径名里的普通字符。所以 'foo\t' 是一个匹配名为 "foo\t" 路径的
// 模式，而不是 'foo'。变异体把修剪字符类放宽成 [ \t]+，会把行尾 tab 也吃掉。
// ---------------------------------------------------------------------------
{
  // 定行为：行尾 tab 必须作为字面量保留下来，只命中真正带 tab 的路径。
  const ig = makeIgnore().add('foo' + TAB)
  expectIgnore(ig, 'foo\\t', 'foo' + TAB, true, 'm1 字面 tab 路径')
  expectIgnore(ig, 'foo\\t', 'foo', false, 'm1 tab 不能被当成空格裁掉')

  // 压边界：行尾“空格 + tab”整体不能被修剪；同时行尾纯空格仍要被修剪。
  const mixed = makeIgnore().add('bar ' + TAB)
  expectIgnore(mixed, 'bar \\t', 'bar ' + TAB, true, 'm1 空格+tab 整体保留')
  expectIgnore(mixed, 'bar \\t', 'bar', false, 'm1 空格+tab 不会退化成 bar')

  const spaces = makeIgnore().add('baz  ')
  expectIgnore(spaces, 'baz  ', 'baz', true, 'm1 纯尾随空格照常修剪')

  // 反斜杠转义的尾随空格代表一个字面空格，而不是被裁掉。
  const escaped = makeIgnore().add('qux\\ ')
  expectIgnore(escaped, 'qux\\ ', 'qux ', true, 'm1 转义空格是字面空格')
  expectIgnore(escaped, 'qux\\ ', 'qux', false, 'm1 转义空格不会被裁掉')
}

// ---------------------------------------------------------------------------
// m2：数组入参必须逐条作为独立规则加入，而不是当成“一条模式”
//
// 变异体令 makeArray() 永不识别数组，于是 .add([...]) 会把整个数组当成
// 单个模式（经 String() 变成 'a,b'），数组里的任何成员都不会生效。
// ---------------------------------------------------------------------------
{
  // 定行为：数组里的每一条规则都必须独立生效。
  const ig = makeIgnore().add(['foo', 'bar'])
  expectIgnore(ig, "['foo','bar']", 'foo', true, 'm2 数组首条规则')
  expectIgnore(ig, "['foo','bar']", 'bar', true, 'm2 数组次条规则')
  expectIgnore(ig, "['foo','bar']", 'baz', false, 'm2 数组成员之外的路径')

  // 压边界：数组里的否定规则也必须正常工作；字符串入参（对照组）不受影响。
  const neg = makeIgnore().add(['*.log', '!keep.log'])
  expectIgnore(neg, "['*.log','!keep.log']", 'drop.log', true, 'm2 数组中的忽略规则')
  expectIgnore(neg, "['*.log','!keep.log']", 'keep.log', false, 'm2 数组中的否定规则')

  const one = makeIgnore().add('foo')
  expectIgnore(one, "'foo'", 'foo', true, 'm2 单字符串入参照常生效')

  // filter 同样吃数组：变异体下会对非数组调用 .filter 而直接抛异常。
  const filtered = makeIgnore().add('foo').filter(['foo', 'bar', 'baz'])
  assert.deepStrictEqual(filtered, ['bar', 'baz'], 'm2 filter 数组逐条判定')
}

// ---------------------------------------------------------------------------
// m3：以 '!' 开头的否定规则必须能把已忽略的路径重新放回
//
// 变异体令 negative 永远为 false，'!foo' 变成“再次忽略 foo”，否定语义全失。
// ---------------------------------------------------------------------------
{
  // 定行为：先忽略再否定同一路径，最终不忽略；.test() 要给出 unignored。
  const ig = makeIgnore().add(['foo', '!foo'])
  expectIgnore(ig, "['foo','!foo']", 'foo', false, 'm3 否定规则重新放回')
  assert.strictEqual(ig.test('foo').unignored, true, 'm3 test() 标记 unignored')

  // 压边界：通配忽略后用否定模式挑回一个具体文件；未被挑回的仍忽略。
  const logs = makeIgnore().add(['*.log', '!keep.log'])
  expectIgnore(logs, "['*.log','!keep.log']", 'keep.log', false, 'm3 否定挑回具体文件')
  expectIgnore(logs, "['*.log','!keep.log']", 'other.log', true, 'm3 其它文件仍被忽略')

  // 否定只能“放回”，不能让一条本来就没被忽略的路径凭空被忽略。
  const onlyNeg = makeIgnore().add('!bar')
  expectIgnore(onlyNeg, "'!bar'", 'bar', false, 'm3 单独的否定不产生忽略')
}

// ---------------------------------------------------------------------------
// m4：默认必须忽略大小写（ignorecase 默认 true）
//
// 变异体把默认值改成 false，于是 'foo' 不再匹配 'FOO'、'*.LOG' 不匹配 'x.log'。
// ---------------------------------------------------------------------------
{
  // 定行为：默认忽略大小写。
  const ig = makeIgnore().add('foo')
  expectIgnore(ig, "'foo'", 'FOO', true, 'm4 默认忽略大写')
  expectIgnore(ig, "'foo'", 'foo', true, 'm4 小写自身仍命中')

  // 压边界：通配模式同样要忽略大小写。
  const wild = makeIgnore().add('*.LOG')
  expectIgnore(wild, "'*.LOG'", 'x.log', true, 'm4 通配忽略大小写')
  expectIgnore(wild, "'*.LOG'", 'x.txt', false, 'm4 大小写之外不误伤')

  // 显式 {ignorecase:false} 时必须区分大小写，给默认行为当对照组。
  const strict = makeIgnore({ ignorecase: false }).add('foo')
  expectIgnore(strict, "'foo' (ignorecase:false)", 'FOO', false, 'm4 显式区分大小写')
  expectIgnore(strict, "'foo' (ignorecase:false)", 'foo', true, 'm4 显式下精确命中')
}

// ---------------------------------------------------------------------------
// m5：严格路径检查的默认值不能反
//
// 默认构造必须拒绝 '/foo'、'./foo' 这类非 path.relative() 路径（抛错）；
// {allowRelativePaths:true} 时则放行。变异体把二者的开关对调了。
// ---------------------------------------------------------------------------
{
  // 定行为：默认严格模式下，绝对路径 / ./ / ../ 都必须抛 RangeError。
  const strict = makeIgnore().add('foo')
  assert.throws(() => strict.ignores('/foo'), RangeError, 'm5 默认拒绝绝对路径')
  assert.throws(() => strict.ignores('./foo'), RangeError, 'm5 默认拒绝 ./ 路径')

  // 压边界：放行选项打开后同一类路径不得再抛错，且规则照常生效。
  const relaxed = makeIgnore({ allowRelativePaths: true }).add('foo')
  assert.doesNotThrow(
    () => relaxed.ignores('/foo'),
    'm5 allowRelativePaths 放行绝对路径'
  )
  expectIgnore(relaxed, "'foo' (allowRelative)", '/foo', true, 'm5 放行后规则仍生效')

  // 放行选项只影响校验，不影响正常相对路径；'.' 本身在默认模式下仍非法。
  expectIgnore(relaxed, "'foo' (allowRelative)", 'foo', true, 'm5 放行选项不误伤相对路径')
  assert.throws(() => strict.ignores('.'), RangeError, 'm5 默认拒绝单独的点')
}

// ---------------------------------------------------------------------------
// m6：模式“中间”的斜杠必须让模式锚定到 .gitignore 所在层级
//
// 按 git 语义：模式开头或中间含分隔符时，相对当前层级匹配，不能匹配任意深度。
// 'foo/bar' 命中 'foo/bar' 但不命中 'a/foo/bar'；末尾斜杠不算“中间”，
// 所以 'foo/' 仍可命中任意层级的目录 'a/foo/'。
// 变异体把识别中间斜杠的正则从 /\/(?!$)/ 改成 /\/$/，判定正好被弄反。
// ---------------------------------------------------------------------------
{
  // 定行为：中间带斜杠的模式锚定当前层级，不向下穿透。
  const mid = makeIgnore().add('foo/bar')
  expectIgnore(mid, "'foo/bar'", 'foo/bar', true, 'm6 当前层级直接命中')
  expectIgnore(mid, "'foo/bar'", 'a/foo/bar', false, 'm6 中间斜杠不穿透深层')
  expectIgnore(mid, "'foo/bar'", 'foo/baz', false, 'm6 末段不同不命中')

  // 压边界：仅末尾带斜杠的目录模式不属于“中间斜杠”，仍可匹配任意深度；
  // 且目录模式不匹配同名普通文件。
  const dir = makeIgnore().add('foo/')
  expectIgnore(dir, "'foo/'", 'a/foo/', true, 'm6 末尾斜杠仍可深层匹配目录')
  expectIgnore(dir, "'foo/'", 'a/foo', false, 'm6 目录模式不匹配普通文件')

  // 没有斜杠的普通模式作为对照组，必须能在任意层级命中。
  const bare = makeIgnore().add('foo')
  expectIgnore(bare, "'foo'", 'a/b/foo', true, 'm6 无斜杠模式匹配任意层级')
}

console.log('全部断言通过：' + path.basename(modulePath))
