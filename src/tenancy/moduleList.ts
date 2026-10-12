/** Lockable settings modules — plain data (no React) so the control panel can use it too. */
export const LOCKABLE_MODULES = ['general', 'appearance', 'dashboard', 'notifications', 'forms', 'security', 'data', 'cms'] as const
export type ModuleKey = (typeof LOCKABLE_MODULES)[number]

export const MODULE_LABEL: Record<ModuleKey, string> = {
  general: 'General & brand', appearance: 'Appearance', dashboard: 'Dashboard widgets', notifications: 'Notifications & APIs',
  forms: 'Website forms', security: 'Security & access', data: 'Data & backup', cms: 'Website CMS',
}
