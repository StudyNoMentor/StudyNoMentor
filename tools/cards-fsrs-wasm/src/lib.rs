use fsrs::{
    compute_parameters, ComputeParametersInput, FSRSItem, FSRSReview, MemoryState,
    TrainingConfig, DEFAULT_PARAMETERS, FSRS,
};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

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
struct OptimizeInput {
    items: Vec<InputItem>,
    card_ids: Vec<i64>,
    current_params: Vec<f32>,
    num_relearning_steps: usize,
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
