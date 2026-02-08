use serde_json::Value;
use std::collections::HashMap;

pub fn evaluate_exclusive(expression: Option<&str>, route_ids: &[String], inputs: &HashMap<String, Value>) -> String {
    let default_route = route_ids
        .iter()
        .find(|id| id.eq_ignore_ascii_case("default"))
        .cloned()
        .or_else(|| route_ids.first().cloned())
        .unwrap_or_else(|| "default".to_string());

    let Some(expr) = expression.map(str::trim).filter(|s| !s.is_empty()) else {
        return default_route;
    };

    if route_ids.iter().any(|id| id == expr) {
        return expr.to_string();
    }

    for (route, condition) in parse_route_conditions(expr) {
        if route.eq_ignore_ascii_case("default") {
            continue;
        }
        if eval_bool_expr(&condition, inputs) {
            return route;
        }
    }

    default_route
}

pub fn evaluate_multi(rules: Option<&str>, route_ids: &[String], inputs: &HashMap<String, Value>) -> Vec<String> {
    let Some(text) = rules.map(str::trim).filter(|s| !s.is_empty()) else {
        return route_ids
            .iter()
            .filter(|id| !id.eq_ignore_ascii_case("default"))
            .cloned()
            .collect();
    };

    let mut selected = Vec::new();
    for (route, condition) in parse_route_conditions(text) {
        if route.eq_ignore_ascii_case("default") {
            continue;
        }
        if eval_bool_expr(&condition, inputs) {
            selected.push(route);
        }
    }

    if selected.is_empty() {
      let default = route_ids.iter().find(|id| id.eq_ignore_ascii_case("default")).cloned();
      if let Some(route) = default {
          selected.push(route);
      }
    }

    selected
}

fn parse_route_conditions(text: &str) -> Vec<(String, String)> {
    if text.starts_with('{') {
        if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(text) {
            return map
                .into_iter()
                .map(|(k, v)| (k, v.as_str().unwrap_or("false").to_string()))
                .collect();
        }
    }

    text.split(';')
        .filter_map(|part| {
            let trimmed = part.trim();
            if trimmed.is_empty() {
                return None;
            }
            let (route, expr) = if let Some((left, right)) = trimmed.split_once(':') {
                (left.trim(), right.trim())
            } else if let Some((left, right)) = trimmed.split_once('=') {
                (left.trim(), right.trim())
            } else {
                (trimmed, "true")
            };
            Some((route.to_string(), expr.to_string()))
        })
        .collect()
}

fn eval_bool_expr(expression: &str, inputs: &HashMap<String, Value>) -> bool {
    let or_terms = split_by_operator(expression, "||");
    if or_terms.len() > 1 {
        return or_terms.iter().any(|term| eval_bool_expr(term, inputs));
    }

    let and_terms = split_by_operator(expression, "&&");
    if and_terms.len() > 1 {
        return and_terms.iter().all(|term| eval_bool_expr(term, inputs));
    }

    eval_atom(expression.trim(), inputs)
}

fn eval_atom(atom: &str, inputs: &HashMap<String, Value>) -> bool {
    let trimmed = atom.trim();
    if trimmed.eq_ignore_ascii_case("true") {
        return true;
    }
    if trimmed.eq_ignore_ascii_case("false") {
        return false;
    }

    if let Some(inner) = trimmed.strip_prefix("exists(").and_then(|x| x.strip_suffix(')')) {
        return resolve_value(inner.trim(), inputs).is_some();
    }

    if let Some(inner) = trimmed.strip_prefix("contains(").and_then(|x| x.strip_suffix(')')) {
        if let Some((left, right)) = inner.split_once(',') {
            let source = resolve_value(left.trim(), inputs)
                .and_then(|v| value_to_string(v))
                .unwrap_or_default();
            let needle = parse_literal(right.trim())
                .and_then(|v| value_to_string(&v))
                .unwrap_or_default();
            return source.contains(&needle);
        }
        return false;
    }

    for op in ["==", "!=", ">=", "<=", ">", "<"] {
        if let Some((left, right)) = split_once_outside_quotes(trimmed, op) {
            let left_val = resolve_value(left.trim(), inputs).cloned().unwrap_or(Value::Null);
            let right_val = parse_literal(right.trim()).unwrap_or(Value::String(right.trim().to_string()));
            return compare_values(&left_val, &right_val, op);
        }
    }

    resolve_value(trimmed, inputs)
        .map(is_truthy)
        .unwrap_or(false)
}

fn split_by_operator<'a>(input: &'a str, op: &str) -> Vec<&'a str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut idx = 0;
    let bytes = input.as_bytes();
    let mut in_string = false;

    while idx + op.len() <= input.len() {
        let c = bytes[idx] as char;
        if c == '"' {
            in_string = !in_string;
            idx += 1;
            continue;
        }
        if !in_string && &input[idx..idx + op.len()] == op {
            parts.push(input[start..idx].trim());
            idx += op.len();
            start = idx;
            continue;
        }
        idx += 1;
    }

    parts.push(input[start..].trim());
    parts
}

fn split_once_outside_quotes<'a>(input: &'a str, op: &str) -> Option<(&'a str, &'a str)> {
    let bytes = input.as_bytes();
    let mut idx = 0;
    let mut in_string = false;

    while idx + op.len() <= input.len() {
        let c = bytes[idx] as char;
        if c == '"' {
            in_string = !in_string;
            idx += 1;
            continue;
        }
        if !in_string && &input[idx..idx + op.len()] == op {
            return Some((&input[..idx], &input[idx + op.len()..]));
        }
        idx += 1;
    }

    None
}

fn resolve_value<'a>(path: &str, inputs: &'a HashMap<String, Value>) -> Option<&'a Value> {
    let trimmed = path.trim().trim_start_matches('$');
    let mut segments = trimmed.split('.');
    let first = segments.next()?;
    let mut current = inputs.get(first)?;
    for segment in segments {
        if let Value::Object(map) = current {
            current = map.get(segment)?;
        } else {
            return None;
        }
    }
    Some(current)
}

fn parse_literal(text: &str) -> Option<Value> {
    let t = text.trim();
    if t.starts_with('"') && t.ends_with('"') && t.len() >= 2 {
        return Some(Value::String(t[1..t.len() - 1].to_string()));
    }
    if let Ok(v) = serde_json::from_str::<Value>(t) {
        return Some(v);
    }
    None
}

fn compare_values(left: &Value, right: &Value, op: &str) -> bool {
    let left_num = left.as_f64();
    let right_num = right.as_f64();

    if let (Some(a), Some(b)) = (left_num, right_num) {
        return match op {
            "==" => (a - b).abs() < f64::EPSILON,
            "!=" => (a - b).abs() >= f64::EPSILON,
            ">" => a > b,
            "<" => a < b,
            ">=" => a >= b,
            "<=" => a <= b,
            _ => false,
        };
    }

    let left_s = value_to_string(left).unwrap_or_default();
    let right_s = value_to_string(right).unwrap_or_default();

    match op {
        "==" => left_s == right_s,
        "!=" => left_s != right_s,
        ">" => left_s > right_s,
        "<" => left_s < right_s,
        ">=" => left_s >= right_s,
        "<=" => left_s <= right_s,
        _ => false,
    }
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|x| x != 0.0).unwrap_or(false),
        Value::String(s) => !s.is_empty() && !s.eq_ignore_ascii_case("false"),
        Value::Array(items) => !items.is_empty(),
        Value::Object(map) => !map.is_empty(),
        Value::Null => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn exclusive_picks_matching_route_from_conditions() {
        let routes = vec!["approved".to_string(), "rejected".to_string(), "default".to_string()];
        let mut inputs = HashMap::new();
        inputs.insert("score".to_string(), json!(91));

        let selected = evaluate_exclusive(
            Some("approved: score >= 90; rejected: score < 90; default: true"),
            &routes,
            &inputs,
        );

        assert_eq!(selected, "approved");
    }

    #[test]
    fn exclusive_falls_back_to_default_route() {
        let routes = vec!["x".to_string(), "default".to_string()];
        let mut inputs = HashMap::new();
        inputs.insert("flag".to_string(), json!(false));

        let selected = evaluate_exclusive(Some("x: flag == true"), &routes, &inputs);
        assert_eq!(selected, "default");
    }

    #[test]
    fn multi_choice_selects_multiple_routes() {
        let routes = vec![
            "email".to_string(),
            "sms".to_string(),
            "push".to_string(),
            "default".to_string(),
        ];
        let mut inputs = HashMap::new();
        inputs.insert("priority".to_string(), json!("high"));
        inputs.insert("phone".to_string(), json!("123"));

        let selected = evaluate_multi(
            Some("email: priority == \"high\"; sms: exists(phone); push: priority == \"critical\""),
            &routes,
            &inputs,
        );

        assert_eq!(selected, vec!["email".to_string(), "sms".to_string()]);
    }

    #[test]
    fn multi_choice_uses_default_when_none_match() {
        let routes = vec!["a".to_string(), "default".to_string()];
        let inputs = HashMap::new();
        let selected = evaluate_multi(Some("a: false"), &routes, &inputs);
        assert_eq!(selected, vec!["default".to_string()]);
    }

    #[test]
    fn contains_and_logical_operators_work() {
        let routes = vec!["go".to_string(), "default".to_string()];
        let mut inputs = HashMap::new();
        inputs.insert("text".to_string(), json!("hello world"));
        inputs.insert("enabled".to_string(), json!(true));

        let selected = evaluate_exclusive(
            Some("go: contains(text, \"world\") && enabled == true; default: true"),
            &routes,
            &inputs,
        );

        assert_eq!(selected, "go");
    }
}
