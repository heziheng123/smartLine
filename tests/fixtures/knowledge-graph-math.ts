export const mathAnalysisOutline = [
  '# 数学分析',
  ...Array.from({ length: 22 }, (_, index) => {
    const chapter = index === 2 ? '第三章 函数极限' : `第${index + 1}章`;
    const sectionCount = index === 2 ? 5
      : index < 13 ? ([0, 1, 3, 4, 5, 6, 7].includes(index) ? 4 : 3)
        : index < 15 ? 4 : 3;
    return [
      `## ${chapter}`,
      ...Array.from({ length: sectionCount }, (_, sectionIndex) =>
        `### ${index === 2 && sectionIndex === 0 ? '§1 函数极限概念' : `§${sectionIndex + 1} 第${index + 1}章小节`}`),
    ];
  }).flat(),
].join('\n');
