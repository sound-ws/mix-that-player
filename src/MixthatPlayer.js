import { html, css, LitElement } from 'lit';
import gridStyles from '@soundws/element-styles/grid.js';
import { ifDefined } from 'lit/directives/if-defined.js';

export class MixthatPlayer extends LitElement {
  static styles = [
    gridStyles,
    css`
      :host {
        display: block;
      }
      a.backlink {
        position: absolute;
        right: 0;
        bottom: 0;
        color: var(--sws-stemsplayer-stem-color, --sws-stemsplayer-color);
        font-size: 0.8rem;
        opacity: 0.5;
        text-align: center;
      }
      .alignRight {
        text-align: right;
      }
    `,
  ];

  static properties = {
    src: { type: String },
    track: { type: Object },
    isLoading: { type: Boolean },
    isError: { type: Boolean },
    maxHeight: { attribute: 'max-height' },
    controls: {
      type: String,
      converter: {
        fromAttribute: value => {
          if (value === '') {
            return 'controls';
          }
          return value;
        },
      },
    },
    collapsed: { type: Boolean },
    _isCreatingMix: { state: true },
  };

  constructor() {
    super();
    this.controls = '';
  }

  connectedCallback() {
    super.connectedCallback();
  }

  set src(src) {
    this.track = undefined;
    this._src = src;
    this.load();
  }

  get src() {
    return this._src;
  }

  async load() {
    const { trackuuid } = this;
    try {
      this.isLoading = true;
      this.track = await this.getTrack();
      this.record('PLAY_MIX', {
        origin,
        trackuuid,
      });
    } catch (err) {
      this.isError = true;
      this.record('PLAY_MIX_FAIL', {
        origin: window.location.hostname,
        trackuuid,
      });
      throw err;
    } finally {
      this.isLoading = false;
    }
  }

  async getTrack() {
    const response = await fetch(this._src);
    if (!response.ok) throw new Error('Failed loading track');
    return response.json();
  }

  get canPlayOgg() {
    if (!this._canPlayOgg) {
      this._canPlayOgg = document
        .createElement('audio')
        .canPlayType('audio/ogg');
    }

    return this._canPlayOgg;
  }

  render() {
    return this.track
      ? html`<stemplayer-js max-height=${ifDefined(this.maxHeight)}>
          ${this.controls || this.collapsed !== undefined
            ? html`<stemplayer-js-controls
                slot="header"
                label="${this.track.songTitle}"
              >
                ${this.controls.indexOf('stems') !== -1
                  ? html`<soundws-player-button
                      slot="end"
                      @click=${() => {
                        this.collapsed = !this.collapsed;
                      }}
                      class="w2"
                      title="Mix Stems"
                      type="mix"
                    ></soundws-player-button>`
                  : ''}
                ${this.controls.indexOf('download:mix') !== -1
                  ? html`<soundws-player-button
                      @click=${() => this.createMix('wav')}
                      .disabled=${this.collapsed || this._isCreatingMix}
                      slot="end"
                      class="w2"
                      title="Download Mix"
                      .type="${!this._isCreatingMix
                        ? 'download'
                        : 'downloading'}"
                    ></soundws-player-button>`
                  : ''}
              </stemplayer-js-controls>`
            : ''}
          <!-- hidden stem element that represents mixed audio -->
          ${this.collapsed
            ? html`<stemplayer-js-stem
                .id=${this.track.trackuuid}
                .src="${this.canPlayOgg
                  ? this.track.audio?.['hls:ogg']
                  : this.track.audio?.['hls:mp3']}"
                .waveform="${this.track.audio?.waveform}"
                style="visibility:hidden;height:0;"
              >
              </stemplayer-js-stem>`
            : html`${this.track.stems.map(
                stem =>
                  html`<stemplayer-js-stem
                    .id=${stem.uploaduuid}
                    label="${stem.label}"
                    src="${this.canPlayOgg ? stem['hls:ogg'] : stem['hls:mp3']}"
                    waveform="${stem.waveform}"
                  >
                    <div class="${this.#paddingEndStems}" slot="end"></div
                  ></stemplayer-js-stem>`,
              )}`}

          <a
            class="backlink w2"
            target="blank"
            href="${this.track.webUrl}${this.authToken
              ? `?authToken=${this.authToken}`
              : ''}"
            >MixThat</a
          >
        </stemplayer-js>`
      : '';
  }

  async createMix(format) {
    if (!this.track) throw new Error('Track not loaded: cannot download');

    const { state } = this.player;

    try {
      this._isCreatingMix = true;

      const response = await fetch(this.track.downloadMixUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(this.authToken
            ? { Authorization: `Bearer ${this.authToken}` }
            : {}),
        },
        body: JSON.stringify({
          format,
          stems: state.stems.map(({ id, volume }) => ({
            id,
            volume,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to Create Mix');
      }
      const { _url } = await response.json();
      const { url } = await this.poll(_url);

      this.dispatchEvent(new CustomEvent('mix:ready', { detail: { url } }));
    } finally {
      this._isCreatingMix = false;
    }
  }

  /**
   * Poll the status endpoint until the job is ready
   * @param {src} src
   * @returns {Object} Object containing a url to the generated file
   */
  async poll(src) {
    const response = await fetch(src);

    // check if the job succeeded
    if (!response.ok) throw new Error('Failed to create mix');

    const { job, _url } = await response.json();

    if (job.status === 'STATUS_QUEUED' || job.status === 'STATUS_PROCESSING') {
      // wait for a bit
      await new Promise(done => {
        setTimeout(() => done(), 2500);
      });

      return this.poll(src);
    }

    if (job.status === 'STATUS_SUCCESS') return { url: _url };

    throw Error('Failed to create mix');
  }

  get player() {
    return this.shadowRoot.querySelector('stemplayer-js');
  }

  get authToken() {
    if (this.src) {
      return new URL(this.src).searchParams.get('authToken');
    }

    return undefined;
  }

  record(event, data) {
    setTimeout(() => {
      fetch(`${new URL(this.src).origin}/activity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ event, timestamp: Date.now(), data }),
      });
    }, 1000);
  }

  get trackuuid() {
    return new URL(this.src).pathname
      .replace(/\/?tracks\//, '')
      .replace(/\/stream\/?/, '');
  }

  get #paddingEndStems() {
    const numberOfControlButtons =
      this.controls
        .split(' ')
        .map(x => x.trim())
        .filter(x => ['stems', 'download:mix'].indexOf(x) !== -1).length || 1;
    return `w${numberOfControlButtons * 2}`;
  }
}
