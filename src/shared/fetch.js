import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {warn} from './logging.js';

export async function fetchJson(url, cancellable = null) {
    const bytes = await fetchBytes(url, cancellable);
    return JSON.parse(new TextDecoder().decode(bytes.get_data()));
}

// cancellable lets the caller abort reads on teardown.
export async function fetchBytes(url, cancellable = null) {
    try {
        const contents = await readFileBytes(Gio.File.new_for_uri(url), cancellable);
        return new GLib.Bytes(contents);
    } catch (e) {
        if (!e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            warn(`fetch: ${url} failed: ${e.message}`);
        throw e;
    }
}

// The one promise wrap around load_contents_async for the whole
// extension. Resolves the raw bytes, rejects on any failure.
export function readFileBytes(file, cancellable = null) {
    return new Promise((resolve, reject) => {
        file.load_contents_async(cancellable, (obj, res) => {
            try {
                const [success, contents] = obj.load_contents_finish(res);
                if (!success) {
                    reject(new Error(`Read failed: ${file.get_path()}`));
                    return;
                }
                resolve(contents);
            } catch (e) {
                reject(e);
            }
        });
    });
}
