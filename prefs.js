import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {GeneralPage} from './src/prefs/pages/general.js';
import {AppearancePage} from './src/prefs/pages/appearance.js';
import {ActionPage} from './src/prefs/pages/action.js';
import {ApplicationsPage} from './src/prefs/pages/applications.js';
import {AboutPage} from './src/prefs/pages/about.js';

export default class BetterTrayIconsPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this.initTranslations();
        const settings = this.getSettings();

        window.set_default_size(950, 700);
        const mapId = window.connect('map', () => {
            window.disconnect(mapId);
            const [minWidth] = window.measure(Gtk.Orientation.HORIZONTAL, -1);
            if (minWidth > 0)
                window.set_size_request(minWidth, -1);
        });

        window.add(new GeneralPage(settings));
        window.add(new AppearancePage(window, settings));
        window.add(new ActionPage(window, settings));
        window.add(new ApplicationsPage(window, settings));
        window.add(new AboutPage(this.dir, this.metadata, settings));
    }
}
