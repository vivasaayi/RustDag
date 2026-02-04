package app;

import io.javalin.Javalin;
import io.javalin.http.Handler;
import com.fasterxml.jackson.databind.ObjectMapper;

public class Main {
    public static void main(String[] args) {
        Javalin app = Javalin.create(config -> {
            config.http.defaultContentType = "application/json";
        }).start(7000);

        app.post("/execute-graph", ctx -> {
            ObjectMapper mapper = new ObjectMapper();
            GraphDefinition graph = mapper.readValue(ctx.body(), GraphDefinition.class);
            // Convert to LangGraph4j model (example helper)
            // LangGraphExecutor.executeGraph(graph);
            ctx.status(200).result("ok");
        });

        app.get("/healthcheck", ctx -> ctx.result("ok"));
    }
}
