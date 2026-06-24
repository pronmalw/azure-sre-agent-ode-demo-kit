module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../tests/frontend/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        contoso: {
          blue: '#0078D4',
          dark: '#003087',
        },
      },
    },
  },
  plugins: [],
};
