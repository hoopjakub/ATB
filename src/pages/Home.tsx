import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { GameInfo } from "../types";
import { api } from "../lib/api";

const MARQUEE =
  "no accounts ★ no ads ★ no mercy ★ drag your friends' taste through the mud ★ live cursors so everyone sees you hesitate ★ ";

export default function Home() {
  const [games, setGames] = useState<GameInfo[]>([]);

  useEffect(() => {
    api<{ games: GameInfo[] }>("/api/games").then((d) => setGames(d.games)).catch(() => {});
  }, []);

  return (
    <main className="home">
      <span className="home__deco" style={{ top: -40, left: -50, transform: "rotate(-14deg)" }}>?!</span>
      <span className="home__deco" style={{ bottom: 60, right: -30, transform: "rotate(10deg)" }}>S+</span>
      <section className="home__mural">
        <h1 className="home__title">
          <span className="row row--all">ALL</span>
          <span className="row row--the">THE</span>
          <span className="row row--bs">BULLSHIT</span>
        </h1>
        <p className="home__sub">
          the mini-games arcade for you &amp; your degenerate friends. <b>pick a game ↓</b>
        </p>
      </section>

      <div className="marquee">
        <span className="marquee__inner">{MARQUEE.repeat(4)}</span>
      </div>

      <section className="gamegrid">
        {games.map((g) => (
          <Link key={g.slug} to={`/g/${g.slug}`} className="gamecard">
            <span className="gamecard__sticker sticker sticker--acid">live</span>
            <div className="gamecard__icon">{g.icon}</div>
            <div className="gamecard__name">{g.display_name}</div>
            <div className="gamecard__tag">{g.tagline}</div>
          </Link>
        ))}
        <div className="gamecard gamecard--soon">
          <span className="gamecard__sticker sticker">soon™</span>
          <div className="gamecard__icon">👻</div>
          <div className="gamecard__name">???</div>
          <div className="gamecard__tag">game #4 happens whenever chaos strikes. suggestions welcome.</div>
        </div>
      </section>
    </main>
  );
}
