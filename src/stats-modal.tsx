import { Modal, App, Platform } from "obsidian";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import h from "vhtml";
import {
    Chart,
    BarElement,
    BarController,
    Legend,
    Title,
    Tooltip,
    SubTitle,
    ChartTypeRegistry,
    CategoryScale,
    LinearScale,
    PieController,
    ArcElement,
} from "chart.js";

import type SRPlugin from "src/main";
import { getKeysPreserveType } from "src/utils";
import { textInterval } from "src/scheduling";
import { t } from "src/lang/helpers";

Chart.register(
    BarElement,
    BarController,
    Legend,
    Title,
    Tooltip,
    SubTitle,
    CategoryScale,
    LinearScale,
    PieController,
    ArcElement
);

export interface Stats {
    eases: Record<number, number>;
    intervals: Record<number, number>;
    newCount: number;
    youngCount: number;
    matureCount: number;
}

export class StatsModal extends Modal {
    private plugin: SRPlugin;

    constructor(app: App, plugin: SRPlugin) {
        super(app);

        this.plugin = plugin;

        this.titleEl.setText(t("STATS_TITLE"));

        this.modalEl.style.height = "100%";
        this.modalEl.style.width = "100%";

        if (Platform.isMobile) {
            this.contentEl.style.display = "block";
        }
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.style.textAlign = "center";

        // Add forecast
        let maxN: number = Math.max(...getKeysPreserveType(this.plugin.dueDatesFlashcards));
        for (let dueOffset = 0; dueOffset <= maxN; dueOffset++) {
            if (!Object.prototype.hasOwnProperty.call(this.plugin.dueDatesFlashcards, dueOffset)) {
                this.plugin.dueDatesFlashcards[dueOffset] = 0;
            }
        }

        const dueDatesFlashcardsCopy: Record<number, number> = { 0: 0 };
        for (const [dueOffset, dueCount] of Object.entries(this.plugin.dueDatesFlashcards)) {
            if (dueOffset <= 0) {
                dueDatesFlashcardsCopy[0] += dueCount;
            } else {
                dueDatesFlashcardsCopy[dueOffset] = dueCount;
            }
        }

        const cardStats: Stats = this.plugin.cardStats;
        const scheduledCount: number = cardStats.youngCount + cardStats.matureCount;
        maxN = Math.max(maxN, 1);

        contentEl.innerHTML += (
            <div>
                <canvas id="forecastChart"></canvas>
                <span id="forecastChartSummary"></span>
                <canvas id="intervalsChart"></canvas>
                <span id="intervalsChartSummary"></span>
                <canvas id="easesChart"></canvas>
                <span id="easesChartSummary"></span>
                <div style="width: 50%;">
                    <canvas id="cardTypesChart"></canvas>
                </div>
                <span id="cardTypesChartSummary"></span>
            </div>
        );

        createStatsChart(
            "bar",
            "forecastChart",
            t("FORECAST"),
            t("FORECAST_DESC"),
            Object.keys(dueDatesFlashcardsCopy),
            Object.values(dueDatesFlashcardsCopy),
            t("REVIEWS_PER_DAY", { avg: (scheduledCount / maxN).toFixed(1) }),
            t("SCHEDULED"),
            t("DAYS"),
            t("NUMBER_OF_CARDS")
        );

        maxN = Math.max(...getKeysPreserveType(cardStats.intervals));
        for (let interval = 0; interval <= maxN; interval++) {
            if (!Object.prototype.hasOwnProperty.call(cardStats.intervals, interval)) {
                cardStats.intervals[interval] = 0;
            }
        }

        // Add intervals
        const average_interval: string = textInterval(
                Math.round(
                    (Object.entries(cardStats.intervals)
                        .map(([interval, count]) => interval * count)
                        .reduce((a, b) => a + b, 0) /
                        scheduledCount) *
                        10
                ) / 10 || 0,
                false
            ),
            longest_interval: string = textInterval(
                Math.max(...getKeysPreserveType(cardStats.intervals)) || 0,
                false
            );

        createStatsChart(
            "bar",
            "intervalsChart",
            t("INTERVALS"),
            t("INTERVALS_DESC"),
            Object.keys(cardStats.intervals),
            Object.values(cardStats.intervals),
            t("INTERVALS_SUMMARY", { avg: average_interval, longest: longest_interval }),
            t("COUNT"),
            t("DAYS"),
            t("NUMBER_OF_CARDS")
        );

        // Add eases
        const eases: number[] = getKeysPreserveType(cardStats.eases);
        for (let ease = Math.min(...eases); ease <= Math.max(...eases); ease++) {
            if (!Object.prototype.hasOwnProperty.call(cardStats.eases, ease)) {
                cardStats.eases[ease] = 0;
            }
        }
        const average_ease: number =
            Math.round(
                Object.entries(cardStats.eases)
                    .map(([ease, count]) => ease * count)
                    .reduce((a, b) => a + b, 0) / scheduledCount
            ) || 0;

        createStatsChart(
            "bar",
            "easesChart",
            t("EASES"),
            "",
            Object.keys(cardStats.eases),
            Object.values(cardStats.eases),
            t("EASES_SUMMARY", { avgEase: average_ease }),
            t("COUNT"),
            t("EASES"),
            t("NUMBER_OF_CARDS")
        );

        // Add card types
        const totalCardsCount: number = this.plugin.deckTree.totalFlashcards;
        createStatsChart(
            "pie",
            "cardTypesChart",
            t("CARD_TYPES"),
            t("CARD_TYPES_DESC"),
            [
                `${t("CARD_TYPE_NEW")} - ${Math.round(
                    (cardStats.newCount / totalCardsCount) * 100
                )}%`,
                `${t("CARD_TYPE_YOUNG")} - ${Math.round(
                    (cardStats.youngCount / totalCardsCount) * 100
                )}%`,
                `${t("CARD_TYPE_MATURE")} - ${Math.round(
                    (cardStats.matureCount / totalCardsCount) * 100
                )}%`,
            ],
            [cardStats.newCount, cardStats.youngCount, cardStats.matureCount],
            t("CARD_TYPES_SUMMARY", { totalCardsCount })
        );
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

function createStatsChart(
    type: keyof ChartTypeRegistry,
    canvasId: string,
    title: string,
    subtitle: string,
    labels: string[],
    data: number[],
    summary: string,
    seriesTitle = "",
    xAxisTitle = "",
    yAxisTitle = ""
) {
    let scales = {},
        backgroundColor = ["#2196f3"];
    if (type !== "pie") {
        scales = {
            x: {
                title: {
                    display: true,
                    text: xAxisTitle,
                },
            },
            y: {
                title: {
                    display: true,
                    text: yAxisTitle,
                },
            },
        };
    } else {
        backgroundColor = ["#2196f3", "#4caf50", "green"];
    }

    new Chart(document.getElementById(canvasId) as HTMLCanvasElement, {
        type,
        data: {
            labels,
            datasets: [
                {
                    label: seriesTitle,
                    backgroundColor,
                    data,
                },
            ],
        },
        options: {
            scales,
            plugins: {
                title: {
                    display: true,
                    text: title,
                },
                subtitle: {
                    display: true,
                    text: subtitle,
                },
                legend: {
                    display: false,
                },
            },
        },
    });

    document.getElementById(`${canvasId}Summary`).innerText = summary;
}
