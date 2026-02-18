import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'light',
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
  typography: {
    fontSize: 12,
    fontFamily: '"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    h6: { fontWeight: 700, letterSpacing: '-0.02em' },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600, fontSize: '0.8rem' },
    body2: { fontSize: '0.8rem' },
    caption: { fontSize: '0.7rem', color: '#5A7A7A' },
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
        root: { '&:before': { display: 'none' }, boxShadow: 'none', border: '1px solid #D8E8E6' },
      },
    },
  },
});

export default theme;
