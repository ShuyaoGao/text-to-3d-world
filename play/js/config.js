/* config.js -- 页面上所有名称、档位、演示句子、练习任务集中在这一个文件。
 * 改文字只改这里；署名在 credits.js（由 credits.json 生成）。
 */
window.TTW_CONFIG = {
  APP_TITLE: '文字生成世界',
  APP_SUBTITLE: '一句中文 → 生成计划 → 3D 场景',
  NAMES: {
    ENGINE: '关键词规则引擎',
    FULL_VERSION: '完整版（仓库里的 app/index_full.html）',
    LLM: '大语言模型',
    LLM_NOTE: '本网页只用关键词规则引擎，全程不联网；想让大语言模型理解任意描述，请用仓库里的完整版，自己接本地模型服务或在线接口。'
  },
  SEED: 11,

  // 规则档位（难度预设）：从“原版只认物体”一步步加规则
  LEVELS: [
    { id: 1, name: '原版关键词', short: '只认物体',
      desc: '和项目原来的离线引擎完全一样：整句里出现了哪些物体词就放哪些，同一类只放一次；方位、数量都不管，位置随机。' },
    { id: 2, name: '+ 分句和数量', short: '分句 / 数量',
      desc: '先按逗号、“和”把句子切成小句；每个小句找最长的物体词（“火山”不会被当成“山”），再读出数量（三棵、一片）、大小（高、小）、颜色。' },
    { id: 3, name: '+ 方位', short: '方位',
      desc: '再读出“北边、东南角、中间”这类方位词，把物体放到地图上对应的区域。' },
    { id: 4, name: '+ 相对位置', short: '相对位置',
      desc: '再读懂“山下、湖边、屋前、周围”：被参照的东西不再多放一个，新物体放到它旁边。（默认档）' }
  ],
  DEFAULT_LEVEL: 4,

  // 摆放参数（细调滑块的默认值来自原版代码）
  OVERLAP_DEFAULT: 0.85,
  TRIES_DEFAULT: 26,

  // 观看模式的演示速度
  SPEEDS: [
    { id: 'slow', name: '慢放讲解', type: 110, hold: 9000 },
    { id: 'normal', name: '正常', type: 60, hold: 6000 },
    { id: 'fast', name: '快', type: 25, hold: 3000 }
  ],

  // 观看模式自动演示的句子（每句开始前清空世界）
  DEMO: [
    { text: '北边一座火山，山下一片森林，东边有个湖', say: '“山下”不是又一座山，而是“火山的下面”：第 4 档把森林放到火山旁边。' },
    { text: '中间一座高塔，周围五间红房子，南边几个人在散步', say: '“周围”没有说围着谁，规则就找上一句提到的东西（塔）。“几个”按 4 个算。' },
    { text: '西南有一片花海，花丛旁边三块石头，东北一座雪山', say: '“一片”“一群”没有具体数字，规则按每类物体预设的“一片”个数来放。' },
    { text: '河上有一座拱桥，岸边两棵大树', say: '“拱桥”不在词表里——这就是规则引擎的边界：没见过的词它只能跳过。完整版可以接大语言模型，用基本形状现拼。' }
  ],

  // 我来造 / 练习 的初始世界（与原版打开时的种子场景相同）
  START_PLAN: [
    { type: 'tree', count: 5, area: 'west' },
    { type: 'mountain', count: 1, area: 'north' },
    { type: 'water', count: 1, area: 'east' },
    { type: 'house', count: 1, area: 'center' },
    { type: 'flower', count: 6, area: 'south' }
  ],
  // 随机风景（原版的三套）
  SCENES: [
    [{ type: 'custom', key: 'volcano', count: 1, area: 'north' }, { type: 'tree', count: 10, area: 'north' }, { type: 'water', count: 1, area: 'center' }, { type: 'house', count: 2, area: 'south' }],
    [{ type: 'tower', count: 1, area: 'center' }, { type: 'house', count: 5 }, { type: 'tree', count: 8 }, { type: 'person', count: 4 }],
    [{ type: 'water', count: 2 }, { type: 'rock', count: 8 }, { type: 'tree', count: 6 }, { type: 'flower', count: 12 }]
  ],
  // 我来造：输入框下面的示例（点一下填进去）
  EXAMPLES: ['湖边三棵树和一座红房子', '东北角有一座小木屋，屋前两棵大树', '中间一座高塔，周围五间红房子', '南边一片花海，花丛旁边几块石头', '一座金色的塔和许多气球'],

  // 练习任务（完成一项自动打勾）
  TASKS: [
    { id: 'forest', text: '种一片树林：输入一句带“森林”或“树林”的话', hint: '例如：西边一片森林' },
    { id: 'dir', text: '用方位词把东西放到东北角', hint: '例如：东北角一座塔' },
    { id: 'count', text: '指定数量：让世界里一次多出 3 座房子', hint: '例如：南边三座房子' },
    { id: 'color', text: '给物体上色', hint: '例如：一座红色的塔' },
    { id: 'rel', text: '用相对位置（湖边 / 山下 / 旁边）摆东西', hint: '例如：湖边两棵树' },
    { id: 'level1', text: '把规则档位切到「原版关键词」，再输入一句带方位的话，看它漏掉了什么', hint: '对照右栏：方位那一格会是空的' },
    { id: 'reject', text: '在俯视图里看到被拒绝的落点（红色 ×）', hint: '把“防穿模”调严，再种一片森林' },
    { id: 'delete', text: '点选删除一个物体', hint: '先点「删除：关」打开删除模式，再点 3D 画面里的物体' }
  ],

  // 区域在俯视图里的中文名
  AREA_LABELS: { center: '中', north: '北', south: '南', east: '东', west: '西', northeast: '东北', northwest: '西北', southeast: '东南', southwest: '西南' },
  ROLE_NAMES: { object: '物体', count: '数量', dir: '方位', color: '颜色', size: '大小', ref: '相对位置', unknown: '没认出来' }
};
