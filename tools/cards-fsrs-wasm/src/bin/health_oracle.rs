use fsrs::{evaluate_with_time_series_splits, ComputeParametersInput, FSRSItem, FSRSReview, TrainingConfig};
use serde::Serialize;

#[derive(Serialize)]
struct Output {
    fsrs_items: usize,
    passed: bool,
    log_loss: f32,
    rmse_bins: f32,
    adjusted_log_loss: f32,
    adjusted_rmse: f32,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut items = Vec::<FSRSItem>::new();
    let mut card_ids = Vec::<i64>::new();

    for c in 0..64usize {
        for k in 2..=7usize {
            let mut reviews = vec![FSRSReview { rating: 3, delta_t: 0 }];
            for i in 1..k {
                let rating = if (i + c) % 11 == 0 {
                    1
                } else if (i + c) % 7 == 0 {
                    2
                } else {
                    3
                };
                let delta_t = (1.7_f64.powi((i - 1) as i32)).round().max(1.0) as u32;
                reviews.push(FSRSReview { rating, delta_t });
            }
            items.push(FSRSItem { reviews });
            card_ids.push(100000 + c as i64);
        }
    }

    let eval = evaluate_with_time_series_splits(
        ComputeParametersInput {
            train_set: items.clone(),
            card_ids: Some(card_ids),
            progress: None,
            enable_short_term: true,
            num_relearning_steps: Some(1),
            training_config: Some(TrainingConfig {
                num_epochs: 8,
                ..Default::default()
            }),
        },
        |_| true,
    )?;

    let n = items.len();
    let r = items
        .iter()
        .filter(|item| item.reviews.last().is_some_and(|x| x.rating > 1))
        .count() as f32
        / n as f32;
    let log_adj = 0.623 * (4.0 * r * (1.0 - r)).powf(0.738);
    let rmse_adj = 0.0135 / (r.powf(0.504) - 1.14)
        + 0.176 / (((n as f32 / 1000.0).powf(0.825)) + 2.22)
        + 0.101;
    let adjusted_log_loss = eval.log_loss / log_adj;
    let adjusted_rmse = eval.rmse_bins / rmse_adj;
    let passed = adjusted_log_loss <= 1.11 || adjusted_rmse <= 1.53;

    println!("{}", serde_json::to_string(&Output {
        fsrs_items: n,
        passed,
        log_loss: eval.log_loss,
        rmse_bins: eval.rmse_bins,
        adjusted_log_loss,
        adjusted_rmse,
    })?);
    Ok(())
}
