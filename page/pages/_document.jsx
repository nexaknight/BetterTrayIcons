import {Head, Html, Main} from 'next/document';
import {SiteHead} from '../sections/SiteHead.jsx';

// No NextScript, the page ships without React on the client
export default function Document() {
    return (
        <Html lang="en" data-theme="dark">
            <Head><SiteHead /></Head>
            <body>
                <Main />
                <script type="module" src="app.js" />
                <script type="module" src="prefs.js" />
            </body>
        </Html>
    );
}
