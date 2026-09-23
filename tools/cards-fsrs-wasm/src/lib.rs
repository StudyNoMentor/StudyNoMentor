use fsrs::{
    check_and_fill_parameters, compute_parameters, extract_simulator_config, simulate, Card,
    ComputeParametersInput, FSRSItem, FSRSReview, MemoryState, PostSchedulingFn, ReviewPriorityFn,
    RevlogEntry, RevlogReviewKind, SimulatorConfig, TrainingConfig, DEFAULT_PARAMETERS, FSRS,
};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
use rand::distr::weighted::WeightedIndex;
use rand::distr::Distribution;
use rand::rngs::StdRng;
use rand::SeedableRng;
use rand::RngExt;
use std::sync::Arc;

#[derive(Debug, Deserialize)]
struct InputReview {
    rating: u32,
    delta_t: u32,
}

#[derive(Debug, Deserialize)]
struct InputItem {
    reviews: Vec<InputReview>,
}

#[derive(Debug, Deserialize)]
struct StartingSm2Input {
    ease_factor: f32,
    interval: f32,
    historical_retention: f32,
}

#[derive(Debug, Deserialize)]
struct MemoryStateJsonInput {
    reviews: Vec<InputReview>,
    params: Vec<f32>,
    starting_sm2: Option<StartingSm2Input>,
    desired_retention: f32,
}

#[derive(Debug, Serialize)]
struct MemoryStateJsonOutput {
    stability: f32,
    difficulty: f32,
    next_interval: f32,
}

#[derive(Debug, Deserialize)]
struct OptimizeInput {
    items: Vec<InputItem>,
    card_ids: Vec<i64>,
    current_params: Vec<f32>,
    num_relearning_steps: usize,
}

#[derive(Debug, Deserialize)]
struct HealthCheckInput {
    items: Vec<InputItem>,
    card_ids: Vec<i64>,
    num_relearning_steps: usize,
}

#[derive(Debug, Serialize)]
struct HealthCheckOutput {
    fsrs_items: usize,
    passed: Option<bool>,
    log_loss: Option<f32>,
    rmse_bins: Option<f32>,
    adjusted_log_loss: Option<f32>,
    adjusted_rmse: Option<f32>,
}

#[derive(Debug, Serialize)]
struct OptimizeOutput {
    params: Vec<f32>,
    fsrs_items: usize,
    current_log_loss: f32,
    optimized_log_loss: f32,
    used_current_params: bool,
    fsrs_rs_version: &'static str,
    training_epochs: usize,
    short_term_enabled: bool,
}

fn js_err(message: impl ToString) -> JsValue {
    JsValue::from_str(&message.to_string())
}

fn item_from_input(item: InputItem) -> FSRSItem {
    FSRSItem {
        reviews: item
            .reviews
            .into_iter()
            .map(|review| FSRSReview {
                rating: review.rating,
                delta_t: review.delta_t,
            })
            .collect(),
    }
}

/// Otimizador usado pelo modulo Cards.
///
/// Replica a chamada de Collection::compute_params() do Anki 26.09.2:
/// - fsrs-rs 6.6.2;
/// - short-term habilitado;
/// - card_ids alinhados ao conjunto de treino;
/// - numero de relearning steps informado pelo preset;
/// - 8 epocas, demais hiperparametros nos defaults do fsrs-rs;
/// - comparacao do log loss atual x otimizado e o mesmo fallback de seguranca.
#[wasm_bindgen]
pub fn optimize_json(input_json: &str) -> Result<String, JsValue> {
    let input: OptimizeInput = serde_json::from_str(input_json).map_err(js_err)?;

    if input.items.is_empty() {
        return Err(js_err("FSRS: conjunto de treino vazio"));
    }
    if input.items.len() != input.card_ids.len() {
        return Err(js_err("FSRS: card_ids desalinhados com os itens"));
    }

    let items: Vec<FSRSItem> = input.items.into_iter().map(item_from_input).collect();
    let current_params = if input.current_params.is_empty() {
        DEFAULT_PARAMETERS.to_vec()
    } else {
        input.current_params
    };

    let current_fsrs = FSRS::new(&current_params).map_err(js_err)?;
    let training_config = TrainingConfig {
        num_epochs: 8,
        ..Default::default()
    };

    let mut params = compute_parameters(ComputeParametersInput {
        train_set: items.clone(),
        card_ids: Some(input.card_ids),
        progress: None,
        enable_short_term: true,
        num_relearning_steps: Some(input.num_relearning_steps),
        training_config: Some(training_config),
    })
    .map_err(js_err)?;

    let current_log_loss = current_fsrs
        .evaluate(items.clone(), |_| true)
        .map_err(js_err)?
        .log_loss;
    let optimized_fsrs = FSRS::new(&params).map_err(js_err)?;
    let optimized_log_loss = optimized_fsrs
        .evaluate(items.clone(), |_| true)
        .map_err(js_err)?
        .log_loss;

    let mut used_current_params = false;

    if current_log_loss <= optimized_log_loss {
        if input.num_relearning_steps <= 1 {
            params = current_params.clone();
            used_current_params = true;
        } else {
            let memory_state = MemoryState {
                stability: 1.0,
                difficulty: 1.0,
            };

            let s_fail = current_fsrs
                .next_states(Some(memory_state), 0.9, 2)
                .map_err(js_err)?
                .again;
            let mut s_short_term = s_fail.memory;

            for _ in 0..input.num_relearning_steps {
                s_short_term = current_fsrs
                    .next_states(Some(s_short_term), 0.9, 0)
                    .map_err(js_err)?
                    .good
                    .memory;
            }

            if s_short_term.stability < memory_state.stability {
                params = current_params.clone();
                used_current_params = true;
            }
        }
    }

    serde_json::to_string(&OptimizeOutput {
        params,
        fsrs_items: items.len(),
        current_log_loss,
        optimized_log_loss,
        used_current_params,
        fsrs_rs_version: "6.6.2",
        training_epochs: 8,
        short_term_enabled: true,
    })
    .map_err(js_err)
}

/// Health Check oficial do Anki 26.09.2: a mesma validação temporal
/// evaluate_with_time_series_splits() e os mesmos ajustes/limiares do rslib.
#[wasm_bindgen]
pub fn health_check_json(input_json: &str) -> Result<String, JsValue> {
    let input: HealthCheckInput = serde_json::from_str(input_json).map_err(js_err)?;
    if input.items.len() != input.card_ids.len() {
        return Err(js_err("FSRS Health Check: card_ids desalinhados"));
    }
    let n = input.items.len();
    if n <= 300 {
        return serde_json::to_string(&HealthCheckOutput {
            fsrs_items: n,
            passed: None,
            log_loss: None,
            rmse_bins: None,
            adjusted_log_loss: None,
            adjusted_rmse: None,
        }).map_err(js_err);
    }
    let items: Vec<FSRSItem> = input.items.into_iter().map(item_from_input).collect();
    let eval = fsrs::evaluate_with_time_series_splits(
        ComputeParametersInput {
            train_set: items.clone(),
            card_ids: Some(input.card_ids),
            progress: None,
            enable_short_term: true,
            num_relearning_steps: Some(input.num_relearning_steps),
            training_config: Some(TrainingConfig {
                num_epochs: 8,
                ..Default::default()
            }),
        },
        |_| true,
    ).map_err(js_err)?;

    let r = items.iter().fold(0usize, |acc, item| {
        acc + usize::from(item.reviews.last().map(|x| x.rating).unwrap_or(0) > 1)
    }) as f32 / n as f32;
    let log_adj = 0.623 * (4.0 * r * (1.0 - r)).powf(0.738);
    let rmse_adj = 0.0135 / (r.powf(0.504) - 1.14)
        + 0.176 / (((n as f32 / 1000.0).powf(0.825)) + 2.22)
        + 0.101;
    let adjusted_log_loss = eval.log_loss / log_adj;
    let adjusted_rmse = eval.rmse_bins / rmse_adj;
    let passed = adjusted_log_loss <= 1.11 || adjusted_rmse <= 1.53;

    serde_json::to_string(&HealthCheckOutput {
        fsrs_items: n,
        passed: Some(passed),
        log_loss: Some(eval.log_loss),
        rmse_bins: Some(eval.rmse_bins),
        adjusted_log_loss: Some(adjusted_log_loss),
        adjusted_rmse: Some(adjusted_rmse),
    }).map_err(js_err)
}

/// Calcula o estado de memória pela mesma API de inferência do fsrs-rs usada
/// pelo Anki ao atualizar memory_state. Para históricos truncados, recebe os
/// dados SM-2 da primeira revisão preservada e os converte em starting_state.
#[wasm_bindgen]
pub fn memory_state_json(input_json: &str) -> Result<String, JsValue> {
    let input: MemoryStateJsonInput = serde_json::from_str(input_json).map_err(js_err)?;
    let params = check_and_fill_parameters(&input.params).map_err(js_err)?;
    let fsrs = FSRS::new(&params).map_err(js_err)?;
    let item = FSRSItem {
        reviews: input
            .reviews
            .into_iter()
            .map(|r| FSRSReview { rating: r.rating, delta_t: r.delta_t })
            .collect(),
    };
    let starting_state = if let Some(s) = input.starting_sm2 {
        let mut state = fsrs
            .memory_state_from_sm2(
                s.ease_factor,
                s.interval.max(1.0),
                s.historical_retention.clamp(0.5, 0.99),
            )
            .map_err(js_err)?;
        // O Anki codifica dificuldade FSRS no ease_factor <= 1.1 quando o
        // primeiro registro preservado já foi produzido pelo FSRS.
        if s.ease_factor <= 1.1 {
            state.difficulty = (s.ease_factor - 0.1) * 9.0 + 1.0;
        }
        Some(state)
    } else {
        None
    };
    let state = fsrs.memory_state(item, starting_state).map_err(js_err)?;
    let next_interval = fsrs.next_interval(
        Some(state.stability),
        input.desired_retention.clamp(0.7, 0.99),
        0,
    );
    serde_json::to_string(&MemoryStateJsonOutput {
        stability: state.stability,
        difficulty: state.difficulty,
        next_interval,
    })
    .map_err(js_err)
}


#[derive(Debug, Deserialize)]
struct SimRevlogInput {
    id: i64,
    cid: i64,
    button_chosen: u8,
    interval: i32,
    last_interval: i32,
    ease_factor: u32,
    taken_millis: u32,
    review_kind: u8,
}

#[derive(Debug, Deserialize)]
struct SimCardInput {
    id: i64,
    difficulty: Option<f32>,
    stability: Option<f32>,
    ease_factor: f32,
    last_date: f32,
    due: f32,
    interval: f32,
    lapses: u32,
}

#[derive(Debug, Deserialize)]
struct SimulateInput {
    revlogs: Vec<SimRevlogInput>,
    next_day_at: i64,
    params: Vec<f32>,
    desired_retention: f32,
    historical_retention: f32,
    days_to_simulate: usize,
    new_card_count: usize,
    introduced_today_count: usize,
    new_limit: usize,
    review_limit: usize,
    max_interval: f32,
    new_cards_ignore_review_limit: bool,
    suspend_after_lapses: Option<u32>,
    learning_step_count: usize,
    relearning_step_count: usize,
    review_order: String,
    load_balance: bool,
    easy_days: [f32; 7],
    next_day_weekday_monday: usize,
    cards: Vec<SimCardInput>,
}

#[derive(Debug, Serialize)]
struct SimulateOutput {
    memorized: Vec<f32>,
    reviews: Vec<usize>,
    news: Vec<usize>,
    time: Vec<f32>,
    correct: Vec<usize>,
    introduced: Vec<usize>,
    simulated_cards: usize,
    fsrs_rs_version: &'static str,
}

fn review_kind_from_u8(kind: u8) -> RevlogReviewKind {
    match kind {
        0 => RevlogReviewKind::Learning,
        1 => RevlogReviewKind::Review,
        2 => RevlogReviewKind::Relearning,
        3 => RevlogReviewKind::Filtered,
        // Igual ao rslib 26.09.2: Manual(4) e Rescheduled(5) convergem para
        // fsrs::RevlogReviewKind::Manual antes de extract_simulator_config().
        _ => RevlogReviewKind::Manual,
    }
}

fn fuzz_delta(interval: f32) -> f32 {
    if interval < 2.5 {
        0.0
    } else {
        let mut delta = 1.0;
        for (start, end, factor) in [
            (2.5_f32, 7.0_f32, 0.15_f32),
            (7.0, 20.0, 0.10),
            (20.0, f32::INFINITY, 0.05),
        ] {
            delta += factor * (interval.min(end) - start).max(0.0);
        }
        delta
    }
}

fn constrained_fuzz_bounds(interval: f32, minimum: u32, maximum: u32) -> (u32, u32) {
    let minimum = minimum.min(maximum);
    let interval = interval.clamp(minimum as f32, maximum as f32);
    let delta = fuzz_delta(interval);
    let mut lower = (interval - delta).round() as u32;
    let mut upper = (interval + delta).round() as u32;
    lower = lower.clamp(minimum, maximum);
    upper = upper.clamp(minimum, maximum);
    if upper == lower && upper > 2 && upper < maximum {
        upper = lower + 1;
    }
    (lower, upper)
}

fn easy_load_modifier(value: f32) -> f32 {
    if value == 1.0 { 1.0 } else if value == 0.0 { 0.0001 } else { 0.5 }
}

fn easy_days_modifiers(
    easy_days: &[f32; 7],
    weekdays: &[usize],
    review_counts: &[usize],
) -> Vec<f32> {
    let total_review_count: usize = review_counts.iter().sum();
    let total_percents: f32 = weekdays.iter().map(|&w| easy_load_modifier(easy_days[w])).sum();
    weekdays.iter().zip(review_counts.iter()).map(|(&weekday, &count)| {
        let value = easy_days[weekday];
        if value != 0.0 && value != 1.0 {
            let other_count = (total_review_count.saturating_sub(count)) as f32;
            let other_percent = total_percents - 0.5;
            let normalized = count as f32 / 0.5;
            let threshold = if other_percent > 0.0 { other_count / other_percent } else { f32::INFINITY };
            if normalized > threshold { 0.0001 } else { 1.0 }
        } else {
            easy_load_modifier(value)
        }
    }).collect()
}

fn simulator_post_schedule(
    interval: f32,
    max_interval: f32,
    day_elapsed: usize,
    due_counts_per_day: &[usize],
    fuzz_seed: u64,
    next_day_weekday_monday: usize,
    easy_days: &[f32; 7],
) -> f32 {
    let (lower, upper) = constrained_fuzz_bounds(interval, 1, max_interval.max(1.0) as u32);
    let mut review_counts = vec![0usize; upper as usize - lower as usize + 1];
    let start = day_elapsed + lower as usize;
    let end = (day_elapsed + upper as usize + 1).min(due_counts_per_day.len());
    if start < due_counts_per_day.len() {
        let copy_len = (end - start).min(review_counts.len());
        review_counts[..copy_len].copy_from_slice(&due_counts_per_day[start..start + copy_len]);
    }

    let possible: Vec<u32> = (lower..=upper).collect();
    let weekdays: Vec<usize> = possible
        .iter()
        .map(|&iv| (next_day_weekday_monday + day_elapsed + iv.saturating_sub(1) as usize) % 7)
        .collect();
    let modifiers = easy_days_modifiers(easy_days, &weekdays, &review_counts);

    let choices: Vec<(u32, f32)> = possible
        .into_iter()
        .enumerate()
        .map(|(i, target)| {
            let count = review_counts[i];
            let weight = if count == 0 {
                1.0
            } else {
                (1.0 / count as f32).powf(2.15)
                    * (1.0 / target.max(1) as f32).powi(3)
                    * modifiers[i]
            };
            (target, weight)
        })
        .collect();

    let Ok(dist) = WeightedIndex::new(choices.iter().map(|x| x.1)) else {
        return interval.round().clamp(1.0, max_interval);
    };
    let mut rng = StdRng::seed_from_u64(fuzz_seed);
    choices[dist.sample(&mut rng)].0 as f32
}

fn review_priority(order: &str, deck_size: usize) -> Option<ReviewPriorityFn> {
    match order {
        "easeAsc" => Some(ReviewPriorityFn::new(|c: &Card| -(c.difficulty * 100.0) as i32)),
        "easeDesc" => Some(ReviewPriorityFn::new(|c: &Card| (c.difficulty * 100.0) as i32)),
        "intervalsAsc" => Some(ReviewPriorityFn::new(|c: &Card| c.interval as i32)),
        "intervalsDesc" => Some(ReviewPriorityFn::new(|c: &Card| (c.interval as i32).saturating_neg())),
        "retrievabilityAsc" => Some(ReviewPriorityFn::new(|c: &Card| (c.retrievability() * 1000.0) as i32)),
        "retrievabilityDesc" => Some(ReviewPriorityFn::new(|c: &Card| -(c.retrievability() * 1000.0) as i32)),
        "day" | "dayThenDeck" | "deckThenDay" => Some(ReviewPriorityFn::new(|c: &Card| c.scheduled_due() as i32)),
        "random" => Some(ReviewPriorityFn::new(move |_c: &Card| rand::rng().random_range(0..deck_size.max(1)) as i32)),
        // O próprio Anki ainda não implementa Added/ReverseAdded/RelativeOverdueness no simulador.
        _ => None,
    }
}

/// Simulador oficial do FSRS usado pelo painel de Cards.
///
/// A rotina delega a evolução temporal ao próprio fsrs-rs 6.6.2. O JavaScript
/// apenas traduz a coleção Study para o mesmo conjunto de entradas que o Anki
/// fornece ao backend: estados S/D, vencimento relativo, revlog e limites.
#[wasm_bindgen]
pub fn simulate_json(input_json: &str) -> Result<String, JsValue> {
    let input: SimulateInput = serde_json::from_str(input_json).map_err(js_err)?;
    if input.days_to_simulate == 0 {
        return Err(js_err("FSRS simulator: days_to_simulate deve ser maior que zero"));
    }

    let params = check_and_fill_parameters(&input.params).map_err(js_err)?;
    let shared_params = Arc::new(params.clone());

    let revlogs = input
        .revlogs
        .into_iter()
        .map(|r| RevlogEntry {
            id: r.id,
            cid: r.cid,
            usn: -1,
            button_chosen: r.button_chosen,
            interval: r.interval,
            last_interval: r.last_interval,
            ease_factor: r.ease_factor,
            taken_millis: r.taken_millis,
            review_kind: review_kind_from_u8(r.review_kind),
        })
        .collect();

    let observed = extract_simulator_config(revlogs, input.next_day_at, true);
    let fsrs = FSRS::new(&params).map_err(js_err)?;
    let mut cards: Vec<Card> = input
        .cards
        .into_iter()
        .filter_map(|c| {
            let memory = match (c.stability, c.difficulty) {
                (Some(stability), Some(difficulty)) if stability > 1e-9 && difficulty.is_finite() => {
                    MemoryState { stability, difficulty }
                }
                _ => fsrs
                    .memory_state_from_sm2(
                        c.ease_factor,
                        c.interval,
                        input.historical_retention.clamp(0.5, 0.99),
                    )
                    .ok()?,
            };
            Some(Card {
                id: c.id,
                difficulty: memory.difficulty,
                stability: memory.stability,
                last_date: c.last_date,
                due: c.due,
                interval: c.interval,
                lapses: c.lapses,
                desired_retention: input.desired_retention,
                parameters: shared_params.clone(),
            })
        })
        .collect();

    if input.new_limit > 0 {
        let introduced_today = input.introduced_today_count.min(input.new_limit);
        cards.extend((0..input.new_card_count).map(|i| Card {
            id: -((i as i64) + 1),
            difficulty: f32::NEG_INFINITY,
            // O Anki usa 1e-8 para o card novo sintético não ser descartado
            // pelo filtro de estabilidade do simulador do fsrs-rs.
            stability: 1e-8,
            last_date: f32::NEG_INFINITY,
            due: ((introduced_today + i) / input.new_limit) as f32,
            interval: f32::NEG_INFINITY,
            lapses: 0,
            desired_retention: input.desired_retention,
            parameters: shared_params.clone(),
        }));
    }

    if cards.is_empty() {
        return Ok(serde_json::to_string(&SimulateOutput {
            memorized: vec![0.0; input.days_to_simulate],
            reviews: vec![0; input.days_to_simulate],
            news: vec![0; input.days_to_simulate],
            time: vec![0.0; input.days_to_simulate],
            correct: vec![0; input.days_to_simulate],
            introduced: vec![0; input.days_to_simulate],
            simulated_cards: 0,
            fsrs_rs_version: "6.6.2",
        }).map_err(js_err)?);
    }

    let post_scheduling_fn = if input.load_balance {
        let easy_days = input.easy_days;
        let next_day_weekday_monday = input.next_day_weekday_monday % 7;
        Some(PostSchedulingFn::new(move |mut ctx| {
            simulator_post_schedule(
                ctx.card.interval,
                ctx.max_interval,
                ctx.today,
                ctx.due_counts_per_day,
                ctx.random_u64(),
                next_day_weekday_monday,
                &easy_days,
            )
        }))
    } else {
        None
    };

    let config = SimulatorConfig {
        deck_size: cards.len(),
        learn_span: input.days_to_simulate,
        max_cost_perday: f32::MAX,
        max_ivl: input.max_interval.max(1.0),
        first_rating_prob: observed.first_rating_prob,
        review_rating_prob: observed.review_rating_prob,
        learn_limit: input.new_limit,
        review_limit: input.review_limit,
        new_cards_ignore_review_limit: input.new_cards_ignore_review_limit,
        suspend_after_lapses: input.suspend_after_lapses,
        post_scheduling_fn,
        review_priority_fn: review_priority(&input.review_order, cards.len()),
        learning_step_transitions: observed.learning_step_transitions,
        relearning_step_transitions: observed.relearning_step_transitions,
        state_rating_costs: observed.state_rating_costs,
        learning_step_count: input.learning_step_count,
        relearning_step_count: input.relearning_step_count,
    };

    // None reproduz o Anki: fsrs-rs usa a semente determinística padrão 42.
    let out = simulate(
        &config,
        &params,
        input.desired_retention,
        None,
        Some(cards),
    )
    .map_err(js_err)?;

    serde_json::to_string(&SimulateOutput {
        memorized: out.memorized_cnt_per_day,
        reviews: out.review_cnt_per_day,
        news: out.learn_cnt_per_day,
        time: out.cost_per_day,
        correct: out.correct_cnt_per_day,
        introduced: out.introduced_cnt_per_day,
        simulated_cards: out.cards.len(),
        fsrs_rs_version: "6.6.2",
    })
    .map_err(js_err)
}
