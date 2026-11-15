import { createUsePageTheme } from '@mobile-core/theme'
import { useThemeStore } from '@/stores/theme'

export const usePageTheme = createUsePageTheme(useThemeStore, 'tms')
