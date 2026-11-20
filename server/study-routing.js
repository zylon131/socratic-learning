const stageWords = '小学[一二三四五六]年级|初中[一二三]年级|高中[一二三]年级|[一二三四五六七八九]年级|初[一二三]|高[一二三]|小学|初中|高中'
const aliases = { 七年级: '初一', 八年级: '初二', 九年级: '初三', 初中一年级: '初一', 初中二年级: '初二', 初中三年级: '初三', 高中一年级: '高一', 高中二年级: '高二', 高中三年级: '高三' }
const topicChoices = {
  math: {
    高一: ['集合与常用逻辑用语', '不等式', '函数入门与单调性'],
    高二: ['数列', '导数与函数', '解析几何'],
    高三: ['函数综合', '数列综合', '概率与统计复习'],
    高中: ['集合与逻辑', '函数', '概率与统计'],
    初中: ['数与式', '方程', '图形与证明'],
    小学: ['数与运算', '图形与测量', '数据与规律'],
  },
  english: {
    初中: ['词汇与日常表达', '时态与句型', '短文阅读'],
    高中: ['阅读与推断', '语法与长句', '写作与表达'],
    小学: ['日常词汇', '简单对话', '读短句'],
  },
  chemistry: {
    高一: ['物质及其变化', '离子反应', '氧化还原反应'],
    高中: ['物质及其变化', '物质的量', '物质结构'],
  },
}

export const asksToDiagnose = (text) => /摸底|测(?:测|一下).*基础|评估.*(?:基础|水平)|基础(?:怎么样|在哪)|(?:看看|判断|测测).{0,24}(?:从哪|从哪里|该从).{0,8}(?:学|开始)/.test(text)
export const skipsDiagnosis = (text) => /跳过(?:摸底|诊断)?|不(?:想|用|要|做)(?:再)?(?:摸底|测试|测了|诊断)|直接(?:学|教|讲|带我学)/.test(text)
export const asksForNewExercise = (text) => /(?:出|给我|来|换)(?:一|这|那)(?:道|个)?(?:新|不同的|同类的)?(?:单选题卡|单选题|题卡|题目|题|练习)/.test(text)

export function requestedStudyScope(text, subject) {
  const input = String(text || '').trim()
  const match = input.match(new RegExp(`(?:^|[，。；、\\s]|我是|我上|我今年|我现在(?:是|上)?|读|学|学习|复习|带我|教|讲|从)(${stageWords})`))
  const stage = match && (aliases[match[1]] || match[1].replace(/^小学(?=.)/, ''))
  if (!stage) return null
  const broad = new RegExp(`^(?:(?:请|请你|能不能|可以|我想|想要|想|要|帮我|带我|教我|从|开始|学习|学|复习|我是|我上|我今年|我现在(?:是|上)?|的|课程|内容|入门|怎么学|${subject.name}|${stageWords}|[\\s，。！？,.!?])+)$`).test(input)
  const band = /^高/.test(stage) ? '高中' : /^初/.test(stage) ? '初中' : '小学'
  return { stage, broad: broad && !asksToDiagnose(input), topics: topicChoices[subject.id]?.[stage] || topicChoices[subject.id]?.[band] || [] }
}
