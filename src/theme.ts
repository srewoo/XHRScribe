import { createTheme, Theme } from '@mui/material/styles';

type Mode = 'light' | 'dark';

const PALETTES = {
  light: {
    mode: 'light' as const,
    primary: { main: '#2D7D7B', light: '#4DA8A6', dark: '#1A5C5A' },
    secondary: { main: '#5BA0A2', light: '#89C4C5', dark: '#3D7A7C' },
    success: { main: '#2E9E6E', light: '#5BBF94', dark: '#1E7A52' },
    warning: { main: '#E5992D', light: '#F0B868', dark: '#C47D1A' },
    error: { main: '#D94F4F', light: '#E88080', dark: '#B83A3A' },
    info: { main: '#3A9AB5', light: '#6CBDD0', dark: '#267A92' },
    background: { default: '#F6FAF9', paper: '#FFFFFF' },
    text: { primary: '#1A2F2F', secondary: '#5A7A7A' },
    divider: '#D8E8E6',
  },
  dark: {
    mode: 'dark' as const,
    primary: { main: '#4DA8A6', light: '#6FC3C1', dark: '#2D7D7B' },
    secondary: { main: '#89C4C5', light: '#A8D8D9', dark: '#5BA0A2' },
    success: { main: '#5BBF94', light: '#7FD3AF', dark: '#2E9E6E' },
    warning: { main: '#F0B868', light: '#F5CD8F', dark: '#E5992D' },
    error: { main: '#E88080', light: '#F0A3A3', dark: '#D94F4F' },
    info: { main: '#6CBDD0', light: '#93D2E0', dark: '#3A9AB5' },
    background: { default: '#0F1B1B', paper: '#16292A' },
    text: { primary: '#E6F2F0', secondary: '#9DBFBD' },
    divider: '#2A4442',
  },
};

export function createAppTheme(mode: Mode): Theme {
  const palette = PALETTES[mode];
  return createTheme({
    palette,
    typography: {
      fontSize: 12,
      fontFamily: '"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      h6: { fontWeight: 700, letterSpacing: '-0.02em' },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600, fontSize: '0.8rem' },
      body2: { fontSize: '0.8rem' },
      // Caption uses the palette's secondary text colour so it reads in both modes.
      caption: { fontSize: '0.7rem', color: palette.text.secondary },
    },
    shape: { borderRadius: 10 },
    components: {
      MuiButton: {
        styleOverrides: {
          root: { textTransform: 'none' as const, fontWeight: 600, borderRadius: 8 },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 500 },
          sizeSmall: { height: 22, fontSize: '0.7rem' },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: { textTransform: 'none' as const, fontWeight: 500, minHeight: 40 },
        },
      },
      MuiAccordion: {
        styleOverrides: {
          // Border follows the theme divider so it isn't invisible in dark mode.
          root: ({ theme }) => ({ '&:before': { display: 'none' }, boxShadow: 'none', border: `1px solid ${theme.palette.divider}` }),
        },
      },
    },
  });
}

// Default light theme retained for any direct importers.
const theme = createAppTheme('light');
export default theme;
