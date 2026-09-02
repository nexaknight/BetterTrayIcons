import {API_MARKER, API_VERSION} from '../../shared/api/ids.js';

// The schema goes out as id and directory, a live Gio.Settings would let a
// peer write our keys.
export class ApiHub {
    constructor(extension, getIndicator) {
        this.marker = API_MARKER;
        this.version = API_VERSION;
        this._extension = extension;
        this._getIndicator = getIndicator;
    }

    // Null until the deferred setup has built the indicator.
    get trayContainer() {
        return this._getIndicator?.() ?? null;
    }

    get schemaId() {
        return this._extension?.metadata['settings-schema'] ?? null;
    }

    get schemaDir() {
        return this._extension?.dir.get_child('schemas').get_path() ?? null;
    }

    destroy() {
        this._extension = null;
        this._getIndicator = null;
    }
}
