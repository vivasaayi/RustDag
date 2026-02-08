use serde_json::Value;
use std::collections::HashMap;
use thiserror::Error;
use crate::secrets;

#[derive(Debug, Error)]
pub enum ExecutorError {
    #[error("missing required field: {0}")]
    MissingField(&'static str),
    #[error("invalid value: {0}")]
    InvalidValue(String),
    #[error("execution error: {0}")]
    Execution(String),
    #[error("feature not enabled: {0}")]
    FeatureNotEnabled(&'static str),
}

pub async fn execute(stage: &str, props: &Value, inputs: &HashMap<String, Value>) -> Result<Value, ExecutorError> {
    let mut resolved = props.clone();
    secrets::resolve_secret_refs(&mut resolved).map_err(ExecutorError::Execution)?;
    match stage {
        "send_mail" => execute_send_mail(&resolved).await,
        "notify_user" => execute_notify_user(&resolved).await,
        "api_call" => execute_api_call(&resolved).await,
        "exec_process" => execute_process(&resolved).await,
        "mysql_query" => execute_db_query(&resolved, "mysql").await,
        "postgres_query" => execute_db_query(&resolved, "postgres").await,
        "mongo_query" => execute_mongo_query(&resolved).await,
        "aws_s3" => execute_aws_s3(&resolved).await,
        "aws_sqs" => execute_aws_sqs(&resolved).await,
        "aws_kinesis" => execute_aws_kinesis(&resolved).await,
        "cloudwatch" => execute_aws_cloudwatch(&resolved).await,
        "kubernetes" => execute_kubernetes(&resolved).await,
        "inline_script" => execute_inline_script(&resolved, inputs).await,
        _ => Err(ExecutorError::InvalidValue(format!("unsupported stage: {stage}"))),
    }
}

fn get_string(props: &Value, key: &'static str) -> Result<String, ExecutorError> {
    props
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or(ExecutorError::MissingField(key))
}

fn get_optional_string(props: &Value, key: &'static str) -> Option<String> {
    props.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

async fn execute_send_mail(props: &Value) -> Result<Value, ExecutorError> {
    #[cfg(not(feature = "email"))]
    {
        let _ = props;
        return Err(ExecutorError::FeatureNotEnabled("email"));
    }

    #[cfg(feature = "email")]
    {
        use lettre::message::{Mailbox, Message};
        use lettre::transport::smtp::authentication::Credentials;
        use lettre::{AsyncSmtpTransport, AsyncTransport, Tokio1Executor};

        let smtp_host = get_string(props, "smtpHost")?;
        let smtp_port = props.get("smtpPort").and_then(|v| v.as_u64()).unwrap_or(587) as u16;
        let username = get_optional_string(props, "username");
        let password = get_optional_string(props, "password");
        let from = get_string(props, "from")?;
        let to = get_string(props, "to")?;
        let subject = get_string(props, "subject")?;
        let body = get_optional_string(props, "body").unwrap_or_default();
        let use_tls = props.get("useTls").and_then(|v| v.as_bool()).unwrap_or(true);

        let from_mailbox: Mailbox = from.parse().map_err(|e| ExecutorError::InvalidValue(e.to_string()))?;
        let to_mailbox: Mailbox = to.parse().map_err(|e| ExecutorError::InvalidValue(e.to_string()))?;

        let message = Message::builder()
            .from(from_mailbox)
            .to(to_mailbox)
            .subject(subject)
            .body(body)
            .map_err(|e| ExecutorError::Execution(e.to_string()))?;

        let mut transport_builder = if use_tls {
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&smtp_host)
                .map_err(|e| ExecutorError::Execution(e.to_string()))?
        } else {
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&smtp_host)
        };

        transport_builder = transport_builder.port(smtp_port);

        if let (Some(user), Some(pass)) = (username, password) {
            transport_builder = transport_builder.credentials(Credentials::new(user, pass));
        }

        let transport = transport_builder.build();
        transport
            .send(message)
            .await
            .map_err(|e| ExecutorError::Execution(e.to_string()))?;

        Ok(serde_json::json!({"status": "sent"}))
    }
}

async fn execute_notify_user(props: &Value) -> Result<Value, ExecutorError> {
    let user_id = get_optional_string(props, "userId").unwrap_or_else(|| "default".to_string());
    let message = get_string(props, "message")?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| ExecutorError::Execution(e.to_string()))?
        .as_secs();

    let entry = serde_json::json!({
        "userId": user_id,
        "message": message,
        "timestamp": timestamp
    });

    let inbox_path = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".llm-dag")
        .join("inbox.jsonl");
    if let Some(parent) = inbox_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ExecutorError::Execution(e.to_string()))?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(inbox_path)
        .map_err(|e| ExecutorError::Execution(e.to_string()))?;
    use std::io::Write;
    writeln!(file, "{}", entry.to_string()).map_err(|e| ExecutorError::Execution(e.to_string()))?;

    Ok(serde_json::json!({"status": "queued"}))
}

async fn execute_api_call(props: &Value) -> Result<Value, ExecutorError> {
    let method = get_string(props, "method")?;
    let url = get_string(props, "url")?;

    let mut request = reqwest::Client::new().request(
        reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| ExecutorError::InvalidValue(e.to_string()))?,
        url,
    );

    if let Some(headers) = props.get("headers") {
        if let Some(map) = parse_kv_object(headers) {
            for (key, value) in map {
                request = request.header(key, value);
            }
        }
    }

    if let Some(query) = props.get("query") {
        if let Some(map) = parse_kv_object(query) {
            request = request.query(&map);
        }
    }

    if let Some(body) = props.get("body") {
        if body.is_object() {
            request = request.json(body);
        } else if let Some(text) = body.as_str() {
            request = request.body(text.to_string());
        }
    }

    let response = request.send().await.map_err(|e| ExecutorError::Execution(e.to_string()))?;
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();

    Ok(serde_json::json!({"status": status, "body": text}))
}

fn parse_kv_object(value: &Value) -> Option<HashMap<String, String>> {
    if let Some(obj) = value.as_object() {
        let mut map = HashMap::new();
        for (k, v) in obj {
            map.insert(k.clone(), v.as_str().unwrap_or(&v.to_string()).to_string());
        }
        return Some(map);
    }

    if let Some(text) = value.as_str() {
        let mut map = HashMap::new();
        for line in text.lines() {
            if let Some((k, v)) = line.split_once('=') {
                map.insert(k.trim().to_string(), v.trim().to_string());
            } else if let Some((k, v)) = line.split_once(':') {
                map.insert(k.trim().to_string(), v.trim().to_string());
            }
        }
        return Some(map);
    }

    None
}

async fn execute_process(props: &Value) -> Result<Value, ExecutorError> {
    let command = get_string(props, "command")?;
    let args = get_optional_string(props, "args").unwrap_or_default();
    let timeout = props.get("timeoutSeconds").and_then(|v| v.as_u64()).unwrap_or(60);

    let arg_list = shell_words::split(&args).unwrap_or_default();
    let mut cmd = tokio::process::Command::new(command);
    if !arg_list.is_empty() {
        cmd.args(arg_list);
    }

    let output = tokio::time::timeout(std::time::Duration::from_secs(timeout), cmd.output())
        .await
        .map_err(|_| ExecutorError::Execution("process timed out".to_string()))
        .and_then(|result| result.map_err(|e| ExecutorError::Execution(e.to_string())))?;

    Ok(serde_json::json!({
        "status": output.status.code().unwrap_or(-1),
        "stdout": String::from_utf8_lossy(&output.stdout),
        "stderr": String::from_utf8_lossy(&output.stderr)
    }))
}

async fn execute_db_query(props: &Value, _flavor: &str) -> Result<Value, ExecutorError> {
    #[cfg(not(feature = "db"))]
    {
        let _ = props;
        let _ = _flavor;
        return Err(ExecutorError::FeatureNotEnabled("db"));
    }

    #[cfg(feature = "db")]
    {
        use sqlx::{AnyPool, Row};

        let connection = get_string(props, "connection")?;
        let query = get_string(props, "query")?;
        let pool = AnyPool::connect(&connection)
            .await
            .map_err(|e| ExecutorError::Execution(e.to_string()))?;

        let rows = sqlx::query(&query)
            .fetch_all(&pool)
            .await
            .map_err(|e| ExecutorError::Execution(e.to_string()))?;

        let mut results = vec![];
        for row in rows {
            let mut map = serde_json::Map::new();
            for (idx, col) in row.columns().iter().enumerate() {
                let value = row.try_get_raw(idx).map_err(|e| ExecutorError::Execution(e.to_string()))?;
                map.insert(col.name().to_string(), serde_json::json!(format!("{:?}", value)));
            }
            results.push(Value::Object(map));
        }

        Ok(serde_json::json!({"rows": results}))
    }
}

async fn execute_mongo_query(props: &Value) -> Result<Value, ExecutorError> {
    #[cfg(not(feature = "db"))]
    {
        let _ = props;
        return Err(ExecutorError::FeatureNotEnabled("db"));
    }

    #[cfg(feature = "db")]
    {
        use mongodb::bson::{doc, Document};
        use mongodb::options::ClientOptions;
        use futures::TryStreamExt;

        let connection = get_string(props, "connection")?;
        let database = get_optional_string(props, "database").unwrap_or_else(|| "admin".to_string());
        let collection = get_string(props, "collection")?;
        let operation = get_optional_string(props, "operation").unwrap_or_else(|| "find".to_string());
        let filter_str = get_optional_string(props, "filter").unwrap_or_else(|| "{}".to_string());

        let options = ClientOptions::parse(connection)
            .await
            .map_err(|e| ExecutorError::Execution(e.to_string()))?;
        let client = mongodb::Client::with_options(options)
            .map_err(|e| ExecutorError::Execution(e.to_string()))?;
        let db = client.database(&database);
        let coll = db.collection::<Document>(&collection);

        let filter: Document = serde_json::from_str::<serde_json::Value>(&filter_str)
            .ok()
            .and_then(|val| mongodb::bson::to_document(&val).ok())
            .unwrap_or_else(|| doc! {});

        match operation.as_str() {
            "find" => {
                let mut cursor = coll
                    .find(filter, None)
                    .await
                    .map_err(|e| ExecutorError::Execution(e.to_string()))?;
                let mut docs = Vec::new();
                while let Some(doc) = cursor
                    .try_next()
                    .await
                    .map_err(|e| ExecutorError::Execution(e.to_string()))?
                {
                    docs.push(serde_json::to_value(doc).map_err(|e| ExecutorError::Execution(e.to_string()))?);
                }
                Ok(serde_json::json!({"docs": docs}))
            }
            "insert" => {
                let payload = get_optional_string(props, "document").unwrap_or_else(|| "{}".to_string());
                let value = serde_json::from_str::<serde_json::Value>(&payload)
                    .map_err(|e| ExecutorError::InvalidValue(e.to_string()))?;
                let doc = mongodb::bson::to_document(&value)
                    .map_err(|e| ExecutorError::InvalidValue(e.to_string()))?;
                let result = coll
                    .insert_one(doc, None)
                    .await
                    .map_err(|e| ExecutorError::Execution(e.to_string()))?;
                Ok(serde_json::json!({"insertedId": format!("{:?}", result.inserted_id)}))
            }
            _ => Err(ExecutorError::InvalidValue("unsupported mongo operation".to_string())),
        }
    }
}

async fn execute_aws_s3(props: &Value) -> Result<Value, ExecutorError> {
    #[cfg(not(feature = "aws"))]
    {
        let _ = props;
        return Err(ExecutorError::FeatureNotEnabled("aws"));
    }

    #[cfg(feature = "aws")]
    {
        let region = get_optional_string(props, "region");
        let action = get_string(props, "action")?;
        let bucket = get_string(props, "bucket")?;

        let mut config = aws_config::load_from_env().await;
        if let Some(region) = region {
            config = aws_config::from_env().region(aws_sdk_s3::config::Region::new(region)).load().await;
        }
        let client = aws_sdk_s3::Client::new(&config);

        match action.as_str() {
            "put" => {
                let key = get_string(props, "key")?;
                let body = get_optional_string(props, "body").unwrap_or_default();
                client
                    .put_object()
                    .bucket(bucket)
                    .key(key)
                    .body(body.into_bytes().into())
                    .send()
                    .await
                    .map_err(|e| ExecutorError::Execution(e.to_string()))?;
                Ok(serde_json::json!({"status": "uploaded"}))
            }
            "get" => {
                let key = get_string(props, "key")?;
                let resp = client
                    .get_object()
                    .bucket(bucket)
                    .key(key)
                    .send()
                    .await
                    .map_err(|e| ExecutorError::Execution(e.to_string()))?;
                let data = resp.body.collect().await.map_err(|e| ExecutorError::Execution(e.to_string()))?;
                Ok(serde_json::json!({"body": String::from_utf8_lossy(&data.into_bytes())}))
            }
            "list" => {
                let prefix = get_optional_string(props, "prefix");
                let resp = client
                    .list_objects_v2()
                    .bucket(bucket)
                    .set_prefix(prefix)
                    .send()
                    .await
                    .map_err(|e| ExecutorError::Execution(e.to_string()))?;
                let keys: Vec<String> = resp
                    .contents()
                    .iter()
                    .filter_map(|obj| obj.key().map(|k| k.to_string()))
                    .collect();
                Ok(serde_json::json!({"keys": keys}))
            }
            "delete" => {
                let key = get_string(props, "key")?;
                client
                    .delete_object()
                    .bucket(bucket)
                    .key(key)
                    .send()
                    .await
                    .map_err(|e| ExecutorError::Execution(e.to_string()))?;
                Ok(serde_json::json!({"status": "deleted"}))
            }
            _ => Err(ExecutorError::InvalidValue("unsupported S3 action".to_string())),
        }
    }
}

async fn execute_aws_sqs(props: &Value) -> Result<Value, ExecutorError> {
    #[cfg(not(feature = "aws"))]
    {
        let _ = props;
        return Err(ExecutorError::FeatureNotEnabled("aws"));
    }

    #[cfg(feature = "aws")]
    {
        let region = get_optional_string(props, "region");
        let action = get_string(props, "action")?;
        let queue_url = get_string(props, "queueUrl")?;
        let mut config = aws_config::load_from_env().await;
        if let Some(region) = region {
            config = aws_config::from_env().region(aws_sdk_sqs::config::Region::new(region)).load().await;
        }
        let client = aws_sdk_sqs::Client::new(&config);

        match action.as_str() {
            "send" => {
                let body = get_string(props, "body")?;
                client
                    .send_message()
                    .queue_url(queue_url)
                    .message_body(body)
                    .send()
                    .await
                    .map_err(|e| ExecutorError::Execution(e.to_string()))?;
                Ok(serde_json::json!({"status": "sent"}))
            }
            "receive" => {
                let max = props.get("max").and_then(|v| v.as_i64()).unwrap_or(1) as i32;
                let resp = client
                    .receive_message()
                    .queue_url(queue_url)
                    .max_number_of_messages(max)
                    .send()
                    .await
                    .map_err(|e| ExecutorError::Execution(e.to_string()))?;
                let messages: Vec<Value> = resp
                    .messages()
                    .iter()
                    .map(|m| serde_json::json!({"body": m.body(), "receiptHandle": m.receipt_handle()}))
                    .collect();
                Ok(serde_json::json!({"messages": messages}))
            }
            "delete" => {
                let receipt = get_string(props, "receiptHandle")?;
                client
                    .delete_message()
                    .queue_url(queue_url)
                    .receipt_handle(receipt)
                    .send()
                    .await
                    .map_err(|e| ExecutorError::Execution(e.to_string()))?;
                Ok(serde_json::json!({"status": "deleted"}))
            }
            _ => Err(ExecutorError::InvalidValue("unsupported SQS action".to_string())),
        }
    }
}

async fn execute_aws_kinesis(props: &Value) -> Result<Value, ExecutorError> {
    #[cfg(not(feature = "aws"))]
    {
        let _ = props;
        return Err(ExecutorError::FeatureNotEnabled("aws"));
    }

    #[cfg(feature = "aws")]
    {
        let region = get_optional_string(props, "region");
        let action = get_string(props, "action")?;
        let stream = get_string(props, "stream")?;
        let mut config = aws_config::load_from_env().await;
        if let Some(region) = region {
            config = aws_config::from_env().region(aws_sdk_kinesis::config::Region::new(region)).load().await;
        }
        let client = aws_sdk_kinesis::Client::new(&config);

        match action.as_str() {
            "put" => {
                let data = get_string(props, "data")?;
                let partition_key = get_optional_string(props, "partitionKey").unwrap_or("default".to_string());
                client
                    .put_record()
                    .stream_name(stream)
                    .partition_key(partition_key)
                    .data(data.into_bytes().into())
                    .send()
                    .await
                    .map_err(|e| ExecutorError::Execution(e.to_string()))?;
                Ok(serde_json::json!({"status": "put"}))
            }
            _ => Err(ExecutorError::InvalidValue("unsupported Kinesis action".to_string())),
        }
    }
}

async fn execute_aws_cloudwatch(props: &Value) -> Result<Value, ExecutorError> {
    #[cfg(not(feature = "aws"))]
    {
        let _ = props;
        return Err(ExecutorError::FeatureNotEnabled("aws"));
    }

    #[cfg(feature = "aws")]
    {
        let region = get_optional_string(props, "region");
        let action = get_string(props, "action").unwrap_or_else(|_| "put_metric".to_string());
        let mut config = aws_config::load_from_env().await;
        if let Some(region) = region {
            config = aws_config::from_env().region(aws_sdk_cloudwatch::config::Region::new(region)).load().await;
        }
        let client = aws_sdk_cloudwatch::Client::new(&config);

        match action.as_str() {
            "put_metric" => {
                let namespace = get_string(props, "namespace")?;
                let metric = get_string(props, "metricName")?;
                let value = props.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
                client
                    .put_metric_data()
                    .namespace(namespace)
                    .metric_data(
                        aws_sdk_cloudwatch::types::MetricDatum::builder()
                            .metric_name(metric)
                            .value(value)
                            .build(),
                    )
                    .send()
                    .await
                    .map_err(|e| ExecutorError::Execution(e.to_string()))?;
                Ok(serde_json::json!({"status": "put_metric"}))
            }
            _ => Err(ExecutorError::InvalidValue("unsupported CloudWatch action".to_string())),
        }
    }
}

async fn execute_kubernetes(props: &Value) -> Result<Value, ExecutorError> {
    #[cfg(not(feature = "k8s"))]
    {
        let _ = props;
        return Err(ExecutorError::FeatureNotEnabled("k8s"));
    }

    #[cfg(feature = "k8s")]
    {
        use kube::{Api, Client};
        use kube::core::{DynamicObject, DynamicResource};
        use kube::api::{Patch, PatchParams};

        let namespace = get_optional_string(props, "namespace").unwrap_or("default".to_string());
        let kind = get_string(props, "kind")?;
        let operation = get_string(props, "operation")?;
        let name = get_optional_string(props, "name");

        let client = Client::try_default()
            .await
            .map_err(|e| ExecutorError::Execution(e.to_string()))?;
        let resource = DynamicResource::new(&kind).within(&namespace);
        let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &resource);

        match operation.as_str() {
            "get" => {
                let name = name.ok_or(ExecutorError::MissingField("name"))?;
                let obj = api.get(&name).await.map_err(|e| ExecutorError::Execution(e.to_string()))?;
                Ok(serde_json::to_value(&obj).map_err(|e| ExecutorError::Execution(e.to_string()))?)
            }
            "list" => {
                let list = api.list(&Default::default()).await.map_err(|e| ExecutorError::Execution(e.to_string()))?;
                Ok(serde_json::to_value(&list).map_err(|e| ExecutorError::Execution(e.to_string()))?)
            }
            "delete" => {
                let name = name.ok_or(ExecutorError::MissingField("name"))?;
                api.delete(&name, &Default::default()).await.map_err(|e| ExecutorError::Execution(e.to_string()))?;
                Ok(serde_json::json!({"status": "deleted"}))
            }
            "apply" => {
                let manifest_value = props.get("manifest").cloned().ok_or(ExecutorError::MissingField("manifest"))?;
                let manifest = if manifest_value.is_string() {
                    let text = manifest_value.as_str().unwrap_or("{}");
                    serde_json::from_str::<Value>(text)
                        .map_err(|e| ExecutorError::InvalidValue(e.to_string()))?
                } else {
                    manifest_value
                };
                let name = name.ok_or(ExecutorError::MissingField("name"))?;
                let patch = Patch::Apply(manifest);
                let params = PatchParams::apply("workflow-engine");
                let obj = api.patch(&name, &params, &patch).await.map_err(|e| ExecutorError::Execution(e.to_string()))?;
                Ok(serde_json::to_value(&obj).map_err(|e| ExecutorError::Execution(e.to_string()))?)
            }
            _ => Err(ExecutorError::InvalidValue("unsupported k8s operation".to_string())),
        }
    }
}

async fn execute_inline_script(_props: &Value, _inputs: &HashMap<String, Value>) -> Result<Value, ExecutorError> {
    Err(ExecutorError::Execution("inline script not implemented yet".to_string()))
}
