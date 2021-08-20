module.exports = {
  'env': {
    'browser': true,
    'es2021': true,
    'jest': true,
  },
  'extends': [
    'google',
  ],
  'parserOptions': {
    'ecmaVersion': 12,
  },
  'plugins': [
    'no-floating-promise',
  ],
  'root': true,
  'rules': {
    'dot-notation': ['error', {'allowKeywords': true }],
    'max-len': 'off',
    'new-cap': 'warn',
    'no-floating-promise/no-floating-promise': 'error',
    'no-reserved-keys': 'off',
    'no-unused-vars': 'warn',
    'no-wrap-func': 'off',
    'require-jsdoc': 'warn',
    'space-after-keywords': 'off',
    'space-return-throw-case': 'off',
    'spaced-line-comment': 'off',
  },
};
