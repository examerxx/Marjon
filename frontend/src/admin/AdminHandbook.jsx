import { useEffect, useState } from "react";

import { hqService } from "./hqService";

import { normalizePaginatedList } from "../api/normalizers";

import { keepWheelInsideScroller } from "./AdminShared";

const adminHandbookActiveKind = {
  "hb-countries": "countries",
  "hb-regions": "regions",
  "hb-districts": "districts",
};

const adminHandbookConfig = {
  countries: {
    title: "Страны",
    singleTitle: "страну",
    editTitle: "страну",
    columns: ["№", "Название", "Статус"],
  },
  regions: {
    title: "Регионы",
    singleTitle: "регион",
    editTitle: "регион",
    columns: ["№", "Название", "Страна", "Статус"],
  },
  districts: {
    title: "Районы",
    singleTitle: "район",
    editTitle: "район",
    columns: ["№", "Название", "Регион", "Статус"],
  },
};

export function TruthfulHandbookLocationPage({ active, search }) {
  const kind = adminHandbookActiveKind[active] || "countries";
  const config = adminHandbookConfig[kind];
  const [locations, setLocations] = useState({ countries: [], regions: [], districts: [] });
  const [loadStates, setLoadStates] = useState({ countries: "loading", regions: "loading", districts: "loading" });
  const query = (search || "").trim().toLowerCase();

  useEffect(() => {
    let activeRequest = true;
    setLoadStates({ countries: "loading", regions: "loading", districts: "loading" });
    Promise.allSettled([
      hqService.listCountries(),
      hqService.listRegions(),
      hqService.listDistricts(),
    ])
      .then(([countriesResult, regionsResult, districtsResult]) => {
        if (!activeRequest) return;
        const countries = countriesResult.status === "fulfilled" ? normalizePaginatedList(countriesResult.value.data).items : [];
        const regions = regionsResult.status === "fulfilled" ? normalizePaginatedList(regionsResult.value.data).items : [];
        const districts = districtsResult.status === "fulfilled" ? normalizePaginatedList(districtsResult.value.data).items : [];
        const countryNames = new Map(countries.map((row) => [String(row.id), row.name]));
        const regionNames = new Map(regions.map((row) => [String(row.id), row.name]));
        setLocations({
          countries: countries.map((row) => ({ id: String(row.id), name: row.name, status: row.status })),
          regions: regions.map((row) => ({
            id: String(row.id),
            name: row.name,
            countryId: String(row.country_id),
            country: countryNames.get(String(row.country_id)) || `ID: ${row.country_id}`,
            status: row.status,
          })),
          districts: districts.map((row) => ({
            id: String(row.id),
            name: row.name,
            regionId: String(row.region_id),
            region: regionNames.get(String(row.region_id)) || `ID: ${row.region_id}`,
            status: row.status,
          })),
        });
        setLoadStates({
          countries: countriesResult.status === "fulfilled" ? "success" : "error",
          regions: regionsResult.status === "fulfilled" ? "success" : "error",
          districts: districtsResult.status === "fulfilled" ? "success" : "error",
        });
      });
    return () => { activeRequest = false; };
  }, []);

  const rows = locations[kind];
  const loadState = loadStates[kind];
  const visibleRows = rows.filter((row) => !query || Object.values(row).some((value) => String(value).toLowerCase().includes(query)));

  return (
    <section className={`admin-handbook-page admin-handbook-page--${kind}`}>
      <div className="admin-handbook-card">
        <div className="admin-handbook-head"><div className="admin-handbook-title"><span aria-hidden="true" /><h2>{config.title}</h2></div></div>
        {loadState === "loading" ? <div className="admin-data-state" role="status">Загрузка справочника...</div> : null}
        {loadState === "error" ? <div className="admin-data-state" role="alert">Не удалось загрузить справочник.</div> : null}
        {loadState === "success" ? <div className="admin-handbook-table-wrap" onWheelCapture={keepWheelInsideScroller}>
          <table className={`admin-handbook-table admin-handbook-table--${kind}`}>
            <thead><tr>{config.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {visibleRows.map((row, index) => <tr key={row.id} data-handbook-id={row.id}>
                <td>{index + 1}</td><td><strong>{row.name}</strong></td>
                {kind === "regions" ? <td data-country-id={row.countryId}>{row.country}</td> : null}
                {kind === "districts" ? <td data-region-id={row.regionId}>{row.region}</td> : null}
                <td><span className={`admin-handbook-status ${row.status ? "is-active" : "is-inactive"}`}>{row.status ? "#активно" : "#неактивно"}</span></td>
              </tr>)}
              {!visibleRows.length ? <tr><td colSpan={config.columns.length} className="admin-handbook-empty">{rows.length ? "Поиск не дал результатов" : "Список пуст"}</td></tr> : null}
            </tbody>
          </table>
        </div> : null}
      </div>
    </section>
  );
}
