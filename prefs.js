import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {setPrefsWindow} from './src/prefs/components/sidebar.js';
import {wireSpacingSync} from './src/prefs/components/spacing.js';
import {GeneralPage} from './src/prefs/pages/generalPage.js';
import {AppearancePage} from './src/prefs/pages/appearancePage.js';
import {ActionPage} from './src/prefs/pages/actionPage.js';
import {ApplicationsPage} from './src/prefs/pages/applicationsPage.js';
import {AboutPage} from './src/prefs/pages/aboutPage.js';

const WINDOW_WIDTH_PX = 1000;
const WINDOW_HEIGHT_PX = 700;

export default class BetterTrayIconsPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this.initTranslations();
        const settings = this.getSettings();

        // Icon themes ship these inconsistently, proton resolves in none and
        // Adwaita has no emblem-synchronizing-symbolic, so prefs bundle theirs.
        const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        const bundledIcons = this.dir.get_child('assets').get_child('icons').get_path();
        if (!iconTheme.get_search_path().includes(bundledIcons))
            iconTheme.add_search_path(bundledIcons);

        window.set_default_size(WINDOW_WIDTH_PX, WINDOW_HEIGHT_PX);

        wireSpacingSync(window, settings);

        setPrefsWindow(window, {
            pages: [
                new GeneralPage(window, settings),
                new AppearancePage(window, settings),
                new ActionPage(window, settings),
                new ApplicationsPage(window, settings),
                new AboutPage(this.dir, this.metadata, settings),
            ],
            iconPath: this.dir.get_child('assets').get_child('icon.png').get_path(),
        });
    }
}
