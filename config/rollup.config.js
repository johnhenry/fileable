import babel from 'rollup-plugin-babel';
import hashbang from 'rollup-plugin-hashbang';
const plugins = [
    babel({
        exclude: 'node_modules/**',
        extensions: ['.ts'],
        babelrc:false,
        presets: [['@babel/preset-env', {
            "useBuiltIns": "usage"
        }], '@babel/preset-react', '@babel/preset-typescript']
    })
];

export default [{
    file: 'dist/cli/fileable.js',
    input: 'src/cli/index.ts',
    plugins: [...plugins, hashbang()]
}, {
    file: 'dist/lib/index.js',
    input: 'src/index.ts',
    format:'cjs'
}].map(({
            file,
            format = 'cjs',
            input,
            plugins: plugins
        }) => ({
        input,
        plugins,
        output: {file, format}
}));
