import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';

import {warn} from './logging.js';

const promisify = (proto, ...methods) => methods.forEach(m => Gio._promisify(proto, m));

promisify(Gio.File.prototype,
    'load_contents_async',
    'replace_contents_async',
    'enumerate_children_async',
    'query_info_async',
    'read_async',
    'replace_async',
    'delete_async');
promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'close_async');
promisify(Gio.OutputStream.prototype, 'splice_async');
promisify(GdkPixbuf.Pixbuf, 'new_from_stream_async');

export const isCancelledError = e => !!e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);

export async function fetchJson(url, cancellable = null) {
    const bytes = await fetchBytes(url, cancellable);
    return JSON.parse(new TextDecoder().decode(bytes.get_data()));
}

export async function fetchBytes(url, cancellable = null) {
    try {
        const contents = await readFileBytes(Gio.File.new_for_uri(url), cancellable);
        return new GLib.Bytes(contents);
    } catch (e) {
        if (!isCancelledError(e))
            warn(`fetch: ${url} failed: ${e.message}`);
        throw e;
    }
}

export async function probePaths(paths, cancellable = null) {
    const probed = await Promise.all(
        [...paths].map(async path => [path, await fileExists(path, cancellable)])
    );
    return new Map(probed);
}

export async function fileExists(path, cancellable = null) {
    try {
        await Gio.File.new_for_path(path).query_info_async(
            'standard::type',
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            cancellable
        );
        return true;
    } catch (e) {
        if (isCancelledError(e))
            throw e;
        return false;
    }
}

// GJS strips the boolean ok value from promisified throwing calls, the
// resolved tuple is [contents, etag] and failures reject instead.
export async function readFileBytes(file, cancellable = null) {
    const [contents] = await file.load_contents_async(cancellable);
    return contents;
}

export async function readFileText(file, cancellable = null) {
    return new TextDecoder('utf-8', {fatal: false}).decode(await readFileBytes(file, cancellable));
}

// next_files_async returns at most the requested count, so drain in batches.
export async function readDirNames(file, cancellable = null) {
    const enumerator = await file.enumerate_children_async(
        'standard::name',
        Gio.FileQueryInfoFlags.NONE,
        GLib.PRIORITY_DEFAULT,
        cancellable
    );

    const names = [];
    const batchSize = 250;
    for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const infos = await enumerator.next_files_async(batchSize, GLib.PRIORITY_DEFAULT, cancellable);
        if (infos.length === 0)
            break;
        for (const info of infos)
            names.push(info.get_name());
    }
    enumerator.close_async(GLib.PRIORITY_DEFAULT, null).catch(() => {});
    return names;
}

export async function readProcFile(pid, name, cancellable = null) {
    if (!pid)
        return null;
    try {
        return await readFileText(Gio.File.new_for_path(`/proc/${pid}/${name}`), cancellable);
    } catch (e) {
        if (isCancelledError(e))
            throw e;
        return null;
    }
}

export async function readEnviron(pid, cancellable = null) {
    const raw = await readProcFile(pid, 'environ', cancellable);
    if (!raw)
        return new Map();
    const map = new Map();
    for (const entry of raw.split('\0')) {
        const separatorIndex = entry.indexOf('=');
        if (separatorIndex > 0)
            map.set(entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1));
    }
    return map;
}
