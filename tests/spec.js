const assert = require("node:assert");
const path = require("path");

const modulePath = process.env.IGNORE_MODULE || path.resolve(__dirname, "..", "index.js");
const make = require(modulePath);

// ---------------------------------------------------------------------------
// 六组测试分别压住 index.js 中六处真实语义。每组都包含：
//   - 一条"定行为"的正面断言（正确实现必须如此）；
//   - 一条"压边界"的断言（把规则放到最容易被放宽/收紧的位置）。
// 任一断言失败 node:assert 即抛出，进程以非零码退出。
// ---------------------------------------------------------------------------

// (1) 尾随空白：git 只修剪尾随空格，绝不修剪 Tab。
//     模式 "foo<TAB>" 是一个名为 "foo<TAB>" 的路径的字面量模式。
{
  const ig = make().add("foo\t");
  assert.strictEqual(ig.ignores("foo\t"), true);  // 与字面 Tab 名匹配
  assert.strictEqual(ig.ignores("foo"), false);   // 不匹配普通文件 foo
  assert.strictEqual(ig.ignores("a/foo\t"), true);

  // 边界："空格 + Tab" 结尾时空格不是纯尾随空格（后面还跟着 Tab），
  // git 一个字符都不会修剪，整段都是字面量。
  const mixed = make().add("foo \t");
  assert.strictEqual(mixed.ignores("foo \t"), true);
  assert.strictEqual(mixed.ignores("foo"), false);
  assert.strictEqual(mixed.ignores("foo "), false);

  // 纯尾随空格照常被修剪掉。
  const spaces = make().add("foo  ");
  assert.strictEqual(spaces.ignores("foo"), true);
  assert.strictEqual(spaces.ignores("foo  "), false);

  // 边界：反斜杠转义的尾随空格保留为一个字面空格。
  const escaped = make().add("foo\\ ");
  assert.strictEqual(escaped.ignores("foo "), true);
  assert.strictEqual(escaped.ignores("foo"), false);
}

// (2) 数组入参：add()/filter() 接受数组，必须逐元素生效，不能当成一条。
{
  const ig = make().add(["foo", "bar"]);
  assert.strictEqual(ig.ignores("foo"), true);
  assert.strictEqual(ig.ignores("bar"), true);
  assert.strictEqual(ig.ignores("baz"), false);
  assert.deepStrictEqual(ig.filter(["foo", "bar", "baz"]), ["baz"]);

  // 边界：数组元素可以是多条规则（含否定），顺序即优先级。
  const mixed = make().add(["*.log", "!keep.log"]);
  assert.deepStrictEqual(
    mixed.filter(["a.log", "keep.log", "x.txt"]),
    ["keep.log", "x.txt"]
  );

  // filter 同样吃路径数组。
  assert.deepStrictEqual(
    make().add("*.log").filter(["a.log", "b.txt", "dir/c.log"]),
    ["b.txt"]
  );

  // 边界：标量字符串入参不能因为支持数组而退化成"一条怪规则"。
  const scalar = make().add("foo");
  assert.strictEqual(scalar.ignores("foo"), true);
  assert.strictEqual(scalar.ignores("x/foo"), true);
}

// (3) 否定规则：以 "!" 开头的模式把先前被忽略的路径重新包含回来。
{
  const ig = make().add(["*.log", "!keep.log"]);
  assert.strictEqual(ig.ignores("other.log"), true);
  assert.strictEqual(ig.ignores("keep.log"), false);   // 否定规则生效
  assert.deepStrictEqual(
    ig.filter(["keep.log", "other.log", "note.md"]),
    ["keep.log", "note.md"]
  );

  // 边界：test() 的结果对象要明确标出"被重新包含"。
  const kept = ig.test("keep.log");
  assert.strictEqual(kept.ignored, false);
  assert.strictEqual(kept.unignored, true);
  const dropped = ig.test("other.log");
  assert.strictEqual(dropped.ignored, true);
  assert.strictEqual(dropped.unignored, false);

  // 边界：只有一条否定规则时路径也不被忽略，并标记为 unignored。
  const lone = make().add("!foo");
  assert.strictEqual(lone.ignores("foo"), false);
  assert.strictEqual(lone.test("foo").unignored, true);

  // 对照：被反斜杠转义的 "\!" 是字面感叹号，不是否定。
  const literal = make().add("\\!important");
  assert.strictEqual(literal.ignores("!important"), true);
}

// (4) 默认忽略大小写（对齐 git core.ignorecase 默认开启）。
{
  const ig = make().add("foo");
  assert.strictEqual(ig.ignores("foo"), true);
  assert.strictEqual(ig.ignores("FOO"), true);        // 默认不区分大小写
  assert.strictEqual(ig.ignores("Foo"), true);
  assert.strictEqual(ig.ignores("dir/FOO"), true);

  // 边界：忽略大小写同样作用于否定规则。
  const neg = make().add(["*.log", "!KEEP.LOG"]);
  assert.strictEqual(neg.ignores("x.log"), true);
  assert.strictEqual(neg.ignores("keep.log"), false);
  assert.strictEqual(neg.ignores("Keep.Log"), false);

  // 边界：显式关闭后严格区分大小写。
  const cs = make({ ignorecase: false }).add("foo");
  assert.strictEqual(cs.ignores("foo"), true);
  assert.strictEqual(cs.ignores("FOO"), false);
  const csAlias = make({ ignoreCase: false }).add("bar");
  assert.strictEqual(csAlias.ignores("BAR"), false);
}

// (5) 严格路径检查：默认只接受 path.relative() 形态的路径。
{
  for (const bad of ["/abs/path", "./foo", "../foo", ".", ".."]) {
    assert.throws(() => make().ignores(bad), /path\.relative/);
  }
  // 边界：空串与非字符串是另一类错误（TypeError）。
  assert.throws(() => make().ignores(""), /must not be empty/);
  assert.throws(() => make().ignores(42), TypeError);

  // 正常的相对路径在严格模式下照常工作。
  assert.strictEqual(make().add("foo").ignores("a/foo"), true);

  // 边界：allowRelativePaths:true 放开限制后这些路径不再抛错。
  const relaxed = make({ allowRelativePaths: true }).add("foo");
  assert.strictEqual(relaxed.ignores("/foo"), true);
  assert.strictEqual(relaxed.ignores("./foo"), true);
  assert.strictEqual(relaxed.ignores("./a/foo"), true);
}

// (6) 模式中间/开头的斜杠：把模式锚定到 .gitignore 所在目录。
{
  const ig = make().add("foo/bar");
  assert.strictEqual(ig.ignores("foo/bar"), true);
  assert.strictEqual(ig.ignores("foo/bar/x"), true);    // 目录之下也匹配
  assert.strictEqual(ig.ignores("a/foo/bar"), false);   // 深层目录不匹配
  assert.strictEqual(ig.ignores("a/foo/bar/x"), false);

  // 边界：开头的斜杠同样表示锚定到根。
  const leading = make().add("/foo");
  assert.strictEqual(leading.ignores("foo"), true);
  assert.strictEqual(leading.ignores("a/foo"), false);

  // 边界：三段中间斜杠，部分前缀不算匹配。
  const deep = make().add("a/b/c");
  assert.strictEqual(deep.ignores("a/b/c"), true);
  assert.strictEqual(deep.ignores("x/a/b/c"), false);
  assert.strictEqual(deep.ignores("a/b"), false);

  // 对照：不含斜杠的模式可在任意层级匹配。
  const bare = make().add("bar");
  assert.strictEqual(bare.ignores("bar"), true);
  assert.strictEqual(bare.ignores("a/b/bar"), true);

  // 对照：只有结尾斜杠（目录标记）不算"中间斜杠"，仍在任意层级匹配。
  const dirOnly = make().add("foo/");
  assert.strictEqual(dirOnly.ignores("foo/x"), true);
  assert.strictEqual(dirOnly.ignores("a/foo/x"), true);
}

console.log("all assertions passed against " + path.basename(modulePath));
