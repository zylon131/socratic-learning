// Offline examples exercise the same protocol as Harness. They are not a curriculum
// or a substitute for the live teacher. Production teaching uses Harness proposals.
export function demoTeacher({ subject, goal, prompt, learning, intent }) {
  const text = (text) => ({ type: 'text', text })
  const result = (blocks, topic = learning?.topic || goal?.topic || '', extra = {}) => JSON.stringify({ version: '1.0', topic, blocks, ...extra })
  if (subject.id === 'chemistry') {
    if (/先补.*基础|不会下标|先修补习/.test(prompt)) {
      return result([
        text('我注意到你在「**化学式下标与原子计数**」这一步还有点拿不准。我们可以先暂停当前原题，花两分钟把基础看清楚：'),
      ], learning?.topic || '化学方程式配平', {
        resolution: 'keep',
        proposed_task_action: {
          type: 'offer_repair',
          targetSkillId: 'chem.subscript_counting',
          reason: '理解下标代表单个分子里的原子数量，再去调配平系数会顺很多。',
        },
        pedagogy: { move: 'offer_repair', objective: '主动建议前置技能 chem.subscript_counting 补习', check: '确认学习者是否愿意先补前置点', reason: '学生提问不会数下标，先提供温和补习建议并保存当前原题现场。' },
      })
    }
    if (/不知道怎么数|不懂原子|画个图|看看图/.test(prompt)) {
      return result([
        text('没关系，我们先把“怎么数原子”看清楚！化学式右下角的数字表示**一个分子里有多少个这种原子**，比如 $H_2O$ 里有 2 个氢原子和 1 个氧原子。\n\n你看下面这幅原子图，左边和右边的红色氧原子个数一样吗？'),
        {
          type: 'explorer',
          component: 'equation',
          title: '原子视角：H₂ + O₂ → H₂O',
          reactants: [{ formula: 'H2', coeff: 1, atoms: { H: 2 } }, { formula: 'O2', coeff: 1, atoms: { O: 2 } }],
          products: [{ formula: 'H2O', coeff: 1, atoms: { H: 2, O: 1 } }],
          interactive: true,
        },
      ], '化学方程式配平', { resolution: 'keep', pedagogy: { move: 'build_intuition', objective: '建立下标计数与原子守恒的直观画面', check: '能从原子图中看出左右氧原子数目差异', reason: '学生表示不知道怎么数原子，需要暂停题卡并切换为原子示意图建立直觉。' } })
    }
    if (!learning?.pending) {
      return result([
        text('我们从一个简单的反应开始，先不急着计算：'),
        { type: 'formula', text: 'H_2 + O_2 \\rightarrow H_2O' },
        { type: 'choice', prompt: '这是一个尚未配平的化学方程式。左右两边氧原子的数量一样吗？', options: ['一样', '不一样', '我不知道怎么数'], answer: 1, neutralOptions: [2], hint: '只看代表氧的元素 O：左边 O₂ 下标是 2，右边 H₂O 里的 O 后面没有写数字（代表 1）。', explanation: '左边 O₂ 中有 2 个氧原子，右边 H₂O 中只有 1 个氧原子，所以两边氧原子数量不一样。' },
      ], '化学方程式配平', { pedagogy: { move: 'diagnose_baseline', objective: '判断学生对化学式下标计数及原子守恒的起点认识', check: '能否分辨左右两边氧原子数量差异', reason: '学生刚切入化学方程式配平，先用一个零压力诊断题摸底计数能力。' } })
    }
    if (/配平|化学方程式/.test(prompt) && !/为什么|解释/.test(prompt)) {
      return result([
        text('我们一起用更基础的步骤来认识这个反应：'),
        { type: 'formula', text: 'H_2 + O_2 \\rightarrow H_2O' },
        { type: 'choice', prompt: '如果只改变化学式前面的系数，下面哪一组能让左右氢、氧原子都一样多？', options: ['H₂ + O₂ → H₂O', '2H₂ + O₂ → 2H₂O', 'H₂ + O₂ → 2H₂O'], answer: 1, hint: '试试数一数每个选项中左右两边 H 和 O 的总个数。', explanation: '2H₂ + O₂ → 2H₂O 左右都是 4 个 H 原子和 2 个 O 原子，满足质量守恒定律。' },
      ], '化学方程式配平')
    }
  }
  if (intent === 'flashcard' || /闪卡|卡片/.test(prompt)) {
    return result([
      text(`已经把 **${subject.name}** 当前阶段的核心概念整理成互动闪卡。点击卡片可以翻面看解析，标记「已掌握」或「再巩固」：`),
      {
        type: 'flashcards',
        title: `${subject.name}核心要点速记卡`,
        cards: subject.id === 'math'
          ? [
              { front: '等式两边同时加或减同一个数，等式还成立吗？', back: '仍然成立！这就像天平两边同时放上或拿走相同重量的砝码，平衡不变。', tag: '等式性质' },
              { front: '分数 $a/b$ 中，分母 $b$ 和分子 $a$ 分别代表什么？', back: '分母 $b$ 表示把整体平均分成的总份数；分子 $a$ 表示取了其中的几份。', tag: '分数意义' },
              { front: '等比数列相邻两项的固定倍数叫什么？', back: '叫作**公比**（通常用 $q$ 表示），满足 $a_n = a_1 \\times q^{n-1}$。', tag: '数列规律' },
            ]
          : [
              { front: `抓一段话的「主旨」时，最容易踩的坑是什么？`, back: '容易把某一个局部细节当成整段话的中心。主旨应该能像一把大伞一样盖住所有关键句。', tag: '阅读方法' },
              { front: '遇到不理解的长难句，第一步先找什么？', back: '先找主干：「谁（主语）」+「做了什么（谓语/核心动作）」，再看修饰限定词。', tag: '句法拆解' },
            ],
      },
    ], learning?.topic || `${subject.name}要点速记`, { suggestions: [{ label: '考考我刚才的卡片', prompt: '请根据刚才的闪卡内容出一道小题考考我。' }] })
  }
  if (intent === 'feynman' || /费曼|我来讲/.test(prompt)) {
    return result([
      text(`太棒了！**以教代学**是最能检验真懂还是假懂的方法。\n\n假设我是你同桌，刚听说「${learning?.topic || subject.example}」，完全一头雾水——你能用最接地气的两三句话，先给我讲讲它到底是干嘛的吗？`),
    ], learning?.topic || '费曼反讲练习', { suggestions: [{ label: '我先打个比方试试', prompt: '我觉得可以把它比作日常生活里的一个现象，你听听看对不对：' }, { label: '你先给我搭个开头', prompt: '我有点不知道怎么开口，你能先提示我第一句该从哪里讲起吗？' }] })
  }
  if (learning?.pending) {
    const q = learning.pending
    if (intent === 'explain' || /直接讲|連続.*未答对|连续.*未答对/.test(prompt)) {
      return result([
        text(`没关系，卡住很正常！我们直接把这道题最关键的一步拆开看：\n\n${q.explanation || q.hint}\n\n现在思路清楚些了吗？你可以用自己的话复述一遍关键点，或者我们换个新例子试试。`),
      ], learning?.topic, { resolution: 'resolve', suggestions: [{ label: '换一道类似的小题试试', prompt: '我明白了，请换一道稍微变化一点的小题让我试试。' }] })
    }
    if (/继续.*(题|学习)|回到/.test(prompt)) return result([text('刚才的题目还在下面。先看看条件，随时试着选一个答案，或者让我给个小提示。')])
    return result([
      text(`我们不急着看最终答案，先把这一步拆小一点：**${q.hint || '先找出题目中的已知信息，再想想需要解释的是什么。'}**\n\n顺着这个线索，你在下面的原题里再试一次看看？`),
    ], learning?.topic, { resolution: 'keep' })
  }
  if (intent === 'answer_followup') {
    const last = learning?.evidence?.at(-1)
    if (last?.unsure) {
      return result([
        text(`虽然你刚才是凭直觉选的「${last.answerText || last.value}」，但直觉很准！\n\n为了确认咱们是真的吃透了——你能用简单的一句话说说，为什么其他选项不合适，或者这一步最关键的依据是什么吗？`),
      ], learning?.topic, { suggestions: [{ label: '我试着说说理由', prompt: '因为题目里的条件直接对应了这个结果。' }, { label: '帮我再点拨一下原因', prompt: '我还是有点模糊，能再用一句话帮我点透原因吗？' }] })
    }
    return result([
      text(`思路非常稳！刚才这一步你已经抓住了核心规律。\n\n我们趁热打铁：如果把条件稍微变一点点，你觉得结论会怎么变？或者点下方按钮我们进入下一小步。`),
    ], learning?.topic, { suggestions: [{ label: '来一道变式挑战', prompt: '好，给我出一道条件稍微变化的小题检验一下迁移能力。' }, { label: '整理成闪卡记下来', prompt: '把刚才的规律做成问答闪卡帮我巩固。' }] })
  }
  if (intent === 'plan') {
    const correct = learning?.evidence?.filter((e) => e.correct).length || 0
    return result([
      text(`这次记录了 **${correct}** 次正确作答。这些记录能反映刚才这几个小问题的掌握情况，我们一步一脚印往下推进：`),
      { type: 'plan', title: '接下来可以这样学', items: [{ title: '把思路讲出来', detail: '用自己的话解释刚才为什么这样做（费曼复述）。' }, { title: '换一个变式例子', detail: '看看条件变化后能否独立推导。' }, { title: '闪卡速记与间隔回顾', detail: '用问答卡片快速自测关键概念。' }] },
    ])
  }
  const level = learning?.level || goal?.level || ''
  const primary = /[一二三四五六]年级/.test(level)
  const high = /^高/.test(level)
  const diagnose = intent === 'diagnose'
  if (subject.id === 'math') {
    if (primary || level === '暂时不确定') return result([
      text(diagnose ? '先从一幅图开始，看看你怎样理解“平均分”。' : '我们先认识分数。把一个整体平均分成 4 份，其中的 1 份就是四分之一。你可以试着改变下面涂色的份数，观察它和整个长条的关系。'),
      { type: 'explorer', component: 'fraction', parts: 4, selected: 1 },
      { type: 'number', prompt: '一张纸平均分成 4 份，取其中 3 份，用分数表示时分子是多少？', answer: 3, hint: '分子表示取了几份。先找找题目里“取其中”后面的数字。', explanation: '取了 3 份，所以分子是 3，分母是平均分成的 4 份。这个分数是 3/4。' },
    ], '分数的意义')
    if (!high) return result([
      text(diagnose ? '先看一个简单方程。试着找出哪个数能让等号两边相等。' : '我们从方程开始。等号像一架天平，左右两边表示相同的数。解方程时，两边减去同一个数，关系仍然成立。'),
      { type: 'formula', text: 'x + 3 = 8' },
      { type: 'number', prompt: '怎样让上面的等式成立？x 应该是多少？', answer: 5, hint: '左边比 x 多了 3。想一想，把两边都减去 3 后剩下什么？', explanation: '两边都减去 3，得到 x = 8 − 3 = 5。代回去，5 + 3 = 8。' },
    ], '方程与等式')
    return result([
      text(diagnose ? '先观察一组数，看看你能发现什么规律。' : '我们从等比数列的公比开始。观察 3，6，12，24：每一步都把前一个数乘以同一个数。这种固定的倍数关系就是理解公比的起点。'),
      ...(diagnose ? [] : [{ type: 'explorer', component: 'sequence', first: 3, ratio: 2 }]),
      { type: 'number', prompt: '数列 3，6，12，24，… 的后一项是前一项的几倍？', answer: 2, hint: '先算 6 ÷ 3，再算 12 ÷ 6。两次得到的结果有什么关系？', explanation: '6 ÷ 3 = 2，12 ÷ 6 = 2，所以相邻两项的固定倍数是 2，也就是公比 q = 2。' },
    ], '等比数列的公比')
  }
  if (subject.id === 'english') return result([
    text(diagnose ? '我们先读一小段，看看你怎样抓住信息。' : primary ? '我们先练习读懂一个短句。先找到“谁”，再看这个人喜欢什么。' : '我们从阅读主旨开始。主旨要覆盖一段话的主要信息，找它时可以先圈出重复出现的对象，再问这些句子共同说明什么。'),
    { type: 'choice', prompt: primary ? 'Tom likes apples. What does Tom like?' : 'Trees cool streets and offer shade. They also help make the air cleaner. What is the main idea?', options: primary ? ['Apples.', 'Books.', 'Cars.'] : ['Trees provide shade only.', 'Trees help make cities more comfortable.', 'All cities have trees.'], answer: primary ? 0 : 1, hint: primary ? 'likes 后面写的就是 Tom 喜欢的东西。' : '试着让你的选择同时覆盖降温、遮阴和改善空气，而不只是一个细节。', explanation: primary ? '句子中 likes apples 表示“喜欢苹果”，所以选择 Apples。' : '第二项概括了降温、遮阴和改善空气。第一项只包含一个细节，第三项在原文中没有依据。' },
  ], primary ? '短句阅读' : '阅读主旨')
  if (subject.id === 'chinese') return result([
    text(diagnose ? '先读一小段，我们看看怎样把主要意思说清楚。' : '我们先练习概括。概括时先找“谁”，再看这个人或这些人主要做了什么。细节可以帮助理解，但不必全部照搬。'),
    { type: 'choice', prompt: primary ? '小雨把书摆整齐，又擦干净桌子，最后扫了地。小雨主要在做什么？' : '小镇书屋每周开门三天。居民轮流整理书架、登记借阅，还会把自己的好书带来分享。这段话主要写什么？', options: primary ? ['整理和打扫房间。', '只是在看书。', '出去买东西。'] : ['书屋什么时候营业。', '居民共同经营并使用书屋。', '书架的摆放方式。'], answer: primary ? 0 : 1, hint: '看看哪一个说法能把文中几件事情都包含进去，而不只是其中一件。', explanation: primary ? '摆书、擦桌子、扫地，都属于整理和打扫房间。第一项把这几件事概括在了一起。' : '整理、登记、分享共同说明居民参与书屋的经营和使用。其他选项只写了局部细节。' },
  ], '概括主要内容')
  return result([
    text(`我们可以按${level || '适合你的'}阶段学习${subject.name}。老师会先从具体情境讲起，再根据你的回答调整下一步。`),
    { type: 'plan', title: '先一起走这一小段', items: [{ title: '从生活中的现象开始', detail: subject.example }, { title: '找出联系和依据', detail: '老师会给出一个例子，引导你观察关键条件。' }, { title: '试着自己解释', detail: '用一个简短问题检查理解，再决定是否继续或补充讲解。' }] },
    text('当前是离线交互预览。这门学科的具体讲解和练习将在连接学习老师后，按你的阶段与回答生成。'),
  ])
}
