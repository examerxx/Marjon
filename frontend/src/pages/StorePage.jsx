import { useEffect, useState } from "react";

import Icon from "../components/Icon";
import { t } from "../i18n/t";

/**
 * Marjon store — страница кабинета владельца (/store).
 *
 * Показывает файлы десктопа из манифеста, который лежит рядом с самими
 * установщиками: /store/files/manifest.json. Список берём из файла, а не из
 * БД, чтобы таблица не расходилась с тем, что реально можно скачать.
 */
const MANIFEST_URL = "/store/files/manifest.json";
const FILES_BASE = "/store/files/";

const PLATFORM_LABELS = {
  windows: "Windows",
  win: "Windows",
  android: "Android",
  ios: "iOS",
  macos: "macOS",
};

function platformLabel(platform) {
  const key = String(platform || "").trim().toLowerCase();
  return PLATFORM_LABELS[key] || platform || "—";
}

function formatDate(value) {
  if (!value) return "—";
  const raw = String(value).slice(0, 10);
  const [year, month, day] = raw.split("-");
  if (!year || !month || !day) return raw;
  return `${day}.${month}.${year}`;
}

function formatSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} МБ`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)} КБ`;
  return `${value} Б`;
}

function shortHash(hash) {
  const value = String(hash || "");
  if (value.length <= 20) return value || "—";
  return `${value.slice(0, 12)}…${value.slice(-6)}`;
}

export default function StorePage() {
  const [manifest, setManifest] = useState(null);
  const [loadState, setLoadState] = useState("loading");

  useEffect(() => {
    let activeRequest = true;
    fetch(MANIFEST_URL, { headers: { Accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (!activeRequest) return;
        const releases = Array.isArray(data?.releases) ? data.releases : [];
        setManifest({ ...data, releases });
        setLoadState(releases.length ? "success" : "empty");
      })
      .catch(() => {
        if (!activeRequest) return;
        setManifest(null);
        setLoadState("error");
      });
    return () => {
      activeRequest = false;
    };
  }, []);

  const releases = manifest?.releases || [];

  return (
    <section className="card card-pad">
      <div className="section-header">
        <div>
          <span className="eyebrow">{t("eyebrow.marjon_store")}</span>
          <h2>{t("pages.storepage.prilozhenie_dlya_kassy_i_monobloka")}</h2>
          <p className="section-window__description">
            {t("pages.storepage.ustanovschik_marjon_desktop_dlya_windows_kassa")}
          </p>
        </div>
      </div>

      {loadState === "loading" ? (
        <div className="dashboard-empty" role="status">
          <p>{t("pages.storepage.zagruzka_spiska_faylov")}</p>
        </div>
      ) : null}

      {loadState === "error" ? (
        <div className="dashboard-empty" role="alert">
          <p>{t("pages.storepage.ne_udalos_zagruzit_spisok_faylov_obnovite_stranitsu")}</p>
        </div>
      ) : null}

      {loadState === "empty" ? (
        <div className="dashboard-empty" role="status">
          <p>{t("pages.storepage.faylov_dlya_skachivaniya_poka_net")}</p>
        </div>
      ) : null}

      {loadState === "success" ? (
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("pages.storepage.versiya")}</th>
                <th>{t("pages.storepage.platforma")}</th>
                <th>{t("pages.storepage.fayl")}</th>
                <th>{t("pages.storepage.razmer")}</th>
                <th>{t("pages.storepage.data")}</th>
                <th>SHA-256</th>
                <th>{t("pages.storepage.skachat")}</th>
              </tr>
            </thead>
            <tbody>
              {releases.flatMap((release) => {
                const files = release.files?.length ? release.files : [];
                if (!files.length) {
                  return [
                    <tr key={`${release.version}-empty`}>
                      <td><strong>{release.version}</strong></td>
                      <td>{platformLabel(release.platform)}</td>
                      <td>—</td>
                      <td>—</td>
                      <td>{formatDate(release.date)}</td>
                      <td>—</td>
                      <td>—</td>
                    </tr>,
                  ];
                }
                return files.map((file, index) => (
                  <tr key={`${release.version}-${file.file || index}`}>
                    {index === 0 ? (
                      <>
                        <td rowSpan={files.length}><strong>{release.version}</strong></td>
                        <td rowSpan={files.length}>{platformLabel(release.platform)}</td>
                      </>
                    ) : null}
                    <td>{file.label || file.file || "—"}</td>
                    <td>{formatSize(file.size)}</td>
                    {index === 0 ? (
                      <td rowSpan={files.length}>{formatDate(release.date)}</td>
                    ) : null}
                    <td>
                      <span className="store-hash" title={file.sha256 || ""}>
                        {shortHash(file.sha256)}
                      </span>
                    </td>
                    <td>
                      {file.file ? (
                        <a
                          className="store-download"
                          href={`${FILES_BASE}${encodeURIComponent(file.file)}`}
                          download
                        >
                          <Icon name="bi-download" size={16} />
                          <span>{t("pages.storepage.skachat")}</span>
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
