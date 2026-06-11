import logo from "../assets/marjon-logo.svg";

export default function MarjonLoader({ text = "Загрузка…" }) {
  return (
    <div className="mj-loader">
      <div className="mj-loader__ring">
        <img src={logo} alt="MARJON" className="mj-loader__logo" decoding="async" />
      </div>
      {text ? <p className="mj-loader__text">{text}</p> : null}
    </div>
  );
}
