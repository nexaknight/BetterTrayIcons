import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {warn} from './logging.js';

// cancellable lets the caller abort reads on teardown.
export function fetchBytes(url, cancellable = null) {
    const file = Gio.File.new_for_uri(url);
    return new Promise((resolve, reject) => {
        file.load_contents_async(cancellable, (obj, res) => {
            try {
                const [success, contents] = obj.load_contents_finish(res);
                if (!success) {
                    reject(new Error('Load failed'));
                    return;
                }
                resolve(new GLib.Bytes(contents));
            } catch (e) {
                if (!e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    warn(`fetch: ${url} failed: ${e.message}`);
                reject(e);
            }
        });
    });
}

export async function fetchJson(url, cancellable = null) {
    const bytes = await fetchBytes(url, cancellable);
    return JSON.parse(new TextDecoder().decode(bytes.get_data()));
}
