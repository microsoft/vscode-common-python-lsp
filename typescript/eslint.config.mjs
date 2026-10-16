import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';

export default [
    {
        ignores: ['out/**', 'dist/**', '**/*.d.ts'],
    },
    {
        files: ['**/*.ts'],
        languageOptions: {
            parser,
            ecmaVersion: 6,
            sourceType: 'module',
        },
        plugins: {
            '@typescript-eslint': plugin,
        },
        rules: {
            '@typescript-eslint/naming-convention': 'warn',
            semi: 'warn',
            curly: 'warn',
            eqeqeq: 'warn',
            'no-throw-literal': 'warn',
        },
    },
];
