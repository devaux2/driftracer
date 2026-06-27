export interface ResultLine {
  label: string;
  value: string;
  highlight?: boolean;
}

/** Post-race results overlay: a title, a few stat lines, and Retry / Menu. */
export class Results {
  private root: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "results overlay";
    this.root.style.display = "none";
    container.appendChild(this.root);
  }

  show(
    title: string,
    subtitle: string,
    lines: ResultLine[],
    onRetry: () => void,
    onMenu: () => void
  ): void {
    const rows = lines
      .map(
        (l) => `
        <div class="result-row ${l.highlight ? "hot" : ""}">
          <span class="result-label">${l.label}</span>
          <span class="result-value">${l.value}</span>
        </div>`
      )
      .join("");

    this.root.innerHTML = `
      <div class="results-inner">
        <h1 class="results-title">${title}</h1>
        ${subtitle ? `<p class="results-sub">${subtitle}</p>` : ""}
        <div class="result-rows">${rows}</div>
        <div class="results-btns">
          <button class="start-btn retry-btn">RETRY</button>
          <button class="back-btn menu-btn">MENU</button>
        </div>
      </div>`;

    this.root.querySelector<HTMLButtonElement>(".retry-btn")!.addEventListener("click", onRetry);
    this.root.querySelector<HTMLButtonElement>(".menu-btn")!.addEventListener("click", onMenu);
    this.root.style.display = "";
  }

  hide(): void {
    this.root.style.display = "none";
  }
}
