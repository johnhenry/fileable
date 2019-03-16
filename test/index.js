import tape from 'tape';
import iterator from '../src/iterator.js';
import template from '../example/template.jsx';
tape('one', async ({ end, ok}) => {
    for await (const output of iterator(template(), { folder_context: [] })) {
        ok(output);
    }
    end();
});
