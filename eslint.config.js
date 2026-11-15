import {defineConfig} from 'eslint/config';
import gnome from 'eslint-config-gnome';
import globals from 'globals';

export default defineConfig([
    {
        ignores: ['locale/', '_site/', 'page/node_modules/', 'page/.next/', 'page/out/', 'page/public/src/'],
    },
    gnome.configs.recommended,
    {
        rules: {
            camelcase: ['error', {
                properties: 'never',
            }],
            'consistent-return': 'error',
            eqeqeq: ['error', 'smart'],
            'key-spacing': ['error', {
                mode: 'minimum',
                beforeColon: false,
                afterColon: true,
            }],
            'prefer-arrow-callback': 'error',
            'prefer-const': ['error', {
                destructuring: 'all',
            }],
        },
        languageOptions: {
            globals: {
                global: 'readonly',
            },
        },
    },
    {
        files: ['page/public/**/*.js'],
        languageOptions: {
            globals: globals.browser,
        },
    },
]);
