mkdir -p ./dist/temp/
cp ./static/docs/api_blank.md ./dist/temp/api.md
npm run jsdoc-md -- -s 'src/**/*.{ts, tsx}' -m ./dist/temp/api.md
