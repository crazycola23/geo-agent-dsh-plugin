// 标题保持 title-only：副标题、流程示意图等装饰性文案在精简中移除，理由见 GeoSettingsCard.tsx。
export const zh = {
  title: 'GEO 工作台',
  progress: 'GEO 进度',
} as const

export const en: Record<keyof typeof zh, string> = {
  title: 'GEO Workbench',
  progress: 'GEO Progress',
}
