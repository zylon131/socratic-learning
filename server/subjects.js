export const subjects = [
  {
    id: 'chemistry', name: '化学', color: 'mint', symbol: '化',
    example: '我想学高中化学，化学方程式不会配平。',
    topics: [
      { title: '化学基础与原子守恒', prompt: '我想先搞懂原子、分子和质量守恒，看看化学反应到底发生了什么。' },
      { title: '化学方程式配平', prompt: '我想学化学方程式配平，总是不知道左右两边的系数该怎么调。' },
      { title: '物质的量与溶液计算', prompt: '我想理解物质的量、摩尔质量和它们在计算里的用法。' },
      { title: '氧化还原与离子反应', prompt: '我想弄懂化合价升降、电子转移和离子方程式怎么写。' },
    ],
  },
  {
    id: 'math', name: '数学', color: 'blue', symbol: '∑',
    example: '带我理解一次函数或等比数列的规律。',
    topics: [
      { title: '方程与等量关系', prompt: '我想从方程的平衡思路开始，理解移项和求解为什么成立。' },
      { title: '函数图像与变化规律', prompt: '我想理解一次函数 y = kx + b 里的斜率和截距怎么影响图像。' },
      { title: '分数与比例思维', prompt: '我想借助直观图形理解分数、比例和它们之间的转换。' },
      { title: '数列与归纳推理', prompt: '我想学等比数列和数列规律，弄清公比和通项公式是怎么来的。' },
    ],
  },
  {
    id: 'physics', name: '物理', color: 'violet', symbol: 'φ',
    example: '为什么坐车突然刹车时，身体会向前倾？',
    topics: [
      { title: '运动与受力分析', prompt: '我想理解牛顿定律和画受力分析图的方法，总是容易漏力。' },
      { title: '功、功率与能量守恒', prompt: '我想搞清动能、势能和机械能守恒在实际问题里怎么用。' },
      { title: '电路分析与欧姆定律', prompt: '我想理解串联、并联电路和电压电流分配的规律。' },
    ],
  },
  {
    id: 'english', name: '英语', color: 'mint', symbol: 'Aa',
    example: '阅读理解里，怎么判断文章的主旨？',
    topics: [
      { title: '长难句结构拆解', prompt: '遇到英语长难句总是读晕，我想学怎么先抓主干再看修饰。' },
      { title: '阅读主旨与推断', prompt: '做英语阅读理解时，我想学会区分文章主旨和局部细节。' },
      { title: '时态与语境用法', prompt: '总是分不清现在完成时和一般过去时，能结合语境带我理解吗？' },
    ],
  },
  {
    id: 'chinese', name: '语文', color: 'peach', symbol: '文',
    example: '怎样用自己的话概括一段文章？',
    topics: [
      { title: '现代文概括与主旨', prompt: '我想练习用准确的话概括段落中心和作者表达的情感。' },
      { title: '文言文实词与断句', prompt: '读文言文总是卡壳，我想学怎么结合上下文推断词义和断句。' },
      { title: '写作立意与论证结构', prompt: '写作文时容易流水账，我想学怎么搭清楚段落论点。' },
    ],
  },
  { id: 'biology', name: '生物', color: 'blue', symbol: '生', example: '植物的根为什么会向下生长？', topics: [{ title: '细胞结构与代谢', prompt: '我想弄懂细胞里的主要细胞器和呼吸/光合作用是怎么配合的。' }, { title: '遗传规律与减数分裂', prompt: '我想搞清基因分离定律和自由组合定律怎么分析。' }] },
  { id: 'history', name: '历史', color: 'peach', symbol: '史', example: '怎么根据不同史料解释同一个历史事件？', topics: [{ title: '史料实证与因果分析', prompt: '我想学会从历史背景、多方史料去分析历史事件的原因和影响。' }] },
  { id: 'geography', name: '地理', color: 'violet', symbol: '地', example: '为什么不同纬度的气候不同？', topics: [{ title: '大气环流与气候成因', prompt: '我想搞懂气压带、风带和洋流是怎么影响各地气候的。' }] },
  { id: 'science', name: '科学', color: 'mint', symbol: '科', example: '影子的长度为什么会变化？', topics: [{ title: '观察现象与科学探究', prompt: '我想从一个生活现象出发，学着提出假设并设计对照实验。' }] },
  { id: 'civics', name: '道德与法治', color: 'blue', symbol: '法', example: '遇到意见不一致时，怎样表达自己的理由？', topics: [{ title: '情境思辨与规则意识', prompt: '我想通过真实案例练习从多角度分析规则与责任。' }] },
  { id: 'technology', name: '信息科技', color: 'violet', symbol: '技', example: '什么是算法？可以用生活中的例子说明吗？', topics: [{ title: '算法思维与问题拆解', prompt: '我想理解怎么把日常复杂问题拆解成计算机能执行的清晰步骤。' }] },
  { id: 'arts', name: '艺术', color: 'peach', symbol: '艺', example: '色彩怎么影响画面的感觉？', topics: [{ title: '形式美感与作品赏析', prompt: '我想学习怎样从构图、色彩和时代背景去欣赏一件艺术作品。' }] },
  { id: 'physical-education', name: '体育与健康', color: 'mint', symbol: '体', example: '运动前为什么要热身？', topics: [{ title: '运动生理与科学锻炼', prompt: '我想了解科学热身、心率控制和预防运动损伤的方法。' }] },
  { id: 'labor', name: '劳动', color: 'blue', symbol: '劳', example: '怎样把一个家务任务拆成几个步骤？', topics: [{ title: '流程规划与动手实践', prompt: '我想学习怎样安全、有条理地规划并改进一次手工或生活任务。' }] },
  { id: 'practice', name: '综合实践', color: 'violet', symbol: '研', example: '怎么把一个感兴趣的问题变成小调查？', topics: [{ title: '课题提出与调查研究', prompt: '我想把一个好奇的生活现象设计成可执行的小调查方案。' }] },
]

export function inferSubjectFromText(text = '') {
  const s = String(text)
  if (/化学|方程式|配平|原子|分子|离子|摩尔|氧化|还原|化合价|酸碱|化学式|H2|O2|CO2/i.test(s)) return 'chemistry'
  if (/数学|函数|方程|数列|几何|三角|微积分|导数|概率|分数|向量|不等式/i.test(s)) return 'math'
  if (/物理|力学|受力|牛顿|速度|加速度|电路|电阻|电压|光学|磁场|能量|动量/i.test(s)) return 'physics'
  if (/英语|English|单词|语法|时态|从句|阅读理解|完形/i.test(s)) return 'english'
  if (/语文|古诗|文言文|作文|阅读|修辞|主旨|成语|散文/i.test(s)) return 'chinese'
  if (/生物|细胞|基因|DNA|RNA|遗传|光合|呼吸作用|生态/i.test(s)) return 'biology'
  if (/历史|朝代|史料|近代史|革命|工业|帝国/i.test(s)) return 'history'
  if (/地理|气候|季风|地形|经纬|洋流|板块/i.test(s)) return 'geography'
  if (/信息科技|编程|算法|Python|代码|数据结构/i.test(s)) return 'technology'
  return 'chemistry'
}

export const practice = {
  math: {
    id: 'math-ratio-1', title: '从相邻两项找公比',
    prompt: '数列 3，6，12，24，… 的公比是多少？',
    options: ['2', '3', '6', '12'], answer: 0,
    explanation: '用后一项除以前一项。6 ÷ 3 和 12 ÷ 6 都等于 2，所以公比是 2。',
  },
  english: {
    id: 'english-main-1', title: '找到段落主旨',
    prompt: 'Read: Trees cool streets and offer shade. They also help make the air cleaner. What is the main idea?',
    options: ['Trees provide shade only.', 'Trees help make cities more comfortable.', 'All cities have trees.'],
    answer: 1, explanation: '第二项概括了降温、遮阴和改善空气三点，其余选项只包含部分内容或没有依据。',
  },
  chinese: {
    id: 'chinese-summary-1', title: '概括段落中心',
    prompt: '小镇的书屋每周开门三天。居民轮流整理书架、登记借阅，还会把自己的好书带来分享。这段话主要写什么？',
    options: ['书屋什么时候营业。', '小镇居民怎样共同经营并使用书屋。', '书架的摆放方式。'],
    answer: 1, explanation: '第二项能够概括整理、登记和分享几件事，另外两项只涉及局部细节。',
  },
}
